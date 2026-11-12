import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";

const mocks = vi.hoisted(() => ({
	getDoctorAccess: vi.fn(),
	getDoctorUser: vi.fn(),
	getLocale: vi.fn(() => "en"),
	run: vi.fn(),
	runAs: vi.fn(),
}));

// Same fake as the host's route tests: the handler runs as a plain async fn.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));
vi.mock("@tanstack/react-start/server", () => ({
	getRequestUrl: () => new URL("https://app.ktb.test/consultations/new"),
}));
vi.mock("@ktb/server-fns", () => mocks);

import { Forbidden } from "@ktb/authz";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Email, type EmailSender } from "@ktb/email";

import { PatientInviteRejected, PatientLinks } from "./index.ts";
import {
	approvePatientLinkFn,
	doctorAccessFn,
	invitePatientFn,
	localeFn,
	patientLinksFn,
	revokePatientLinkFn,
} from "./fns.ts";

const DDL = `
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT);
INSERT INTO patients (id, owner_id, name, email) VALUES
  (1, 'doc', 'Ana', 'ana@ktb.test'), (2, 'doc', 'Leo', NULL), (3, 'other', 'Rui', 'rui@ktb.test');
`;
const db = makeDb(makeD1(DDL));

// A secretary acting for the doctor: data scope is the doctor's, the
// email is issued under the doctor's name.
const acting = {
	id: "doc",
	email: "sec@ktb.test",
	name: "Sec",
	actorId: "sec",
	doctor: { name: "Dra. Bia", email: "bia@ktb.test" },
};

const links = {
	list: vi.fn(),
	invite: vi.fn(),
	approve: vi.fn(),
	revoke: vi.fn(),
};
const denied = Effect.fail(new Forbidden({ path: "patient-access.read" }));

const sent: Array<{ to: string; subject: string; text: string }> = [];
/** The deployment's Email service: a sender, or null when email is off. */
let sender: EmailSender | null = null;
const delivering: EmailSender = {
	send: async (message) => {
		sent.push(message);
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	sent.length = 0;
	sender = delivering;
	mocks.getLocale.mockReturnValue("en");
	mocks.getDoctorUser.mockResolvedValue(acting);
	const provide = (effect: Effect.Effect<unknown, unknown, unknown>) =>
		Effect.runPromise(
			(effect as Effect.Effect<unknown, unknown, PatientLinks | Db | Email>).pipe(
				Effect.provideService(PatientLinks, links as never),
				Effect.provideService(Db, db),
				Effect.provideService(Email, sender),
			),
		);
	mocks.runAs.mockImplementation((_user: unknown, effect: never) => provide(effect));
	mocks.run.mockImplementation((effect: never) => provide(effect));
	links.list.mockReturnValue(Effect.succeed([{ id: 7, email: "ana@ktb.test", status: "active" }]));
	links.invite.mockReturnValue(Effect.succeed({ id: 9, email: "ana@ktb.test", status: "invited" }));
	links.approve.mockReturnValue(Effect.succeed(true));
	links.revoke.mockReturnValue(Effect.succeed(true));
});

describe("localeFn / doctorAccessFn", () => {
	it("expose the request's locale and doctor-side standing", async () => {
		mocks.getLocale.mockReturnValue("pt-BR");
		mocks.getDoctorAccess.mockResolvedValue("no-doctor");
		await expect(localeFn()).resolves.toBe("pt-BR");
		await expect(doctorAccessFn()).resolves.toBe("no-doctor");
	});
});

describe("patientLinksFn", () => {
	it("returns the patient — with the record's email — and its links", async () => {
		await expect(patientLinksFn({ data: 1 })).resolves.toEqual({
			patient: { id: 1, name: "Ana", email: "ana@ktb.test" },
			links: [{ id: 7, email: "ana@ktb.test", status: "active" }],
		});
		expect(mocks.runAs).toHaveBeenCalledWith(acting, expect.anything());
		expect(links.list).toHaveBeenCalledWith(1);
	});

	it("carries a null email when the record has none", async () => {
		await expect(patientLinksFn({ data: 2 })).resolves.toMatchObject({
			patient: { id: 2, name: "Leo", email: null },
		});
	});

	it("is null for someone else's patient and for non-doctors", async () => {
		links.list.mockReturnValue(denied);
		await expect(patientLinksFn({ data: 3 })).resolves.toBeNull();
		mocks.getDoctorUser.mockResolvedValue(null);
		await expect(patientLinksFn({ data: 1 })).resolves.toBeNull();
	});
});

describe("invitePatientFn", () => {
	const invite = { patientId: 1, email: "ana@ktb.test", relation: "self" };

	it("creates the link and emails the invitee under the doctor's name", async () => {
		await expect(invitePatientFn({ data: invite })).resolves.toEqual({
			ok: true,
			link: { id: 9, email: "ana@ktb.test", status: "invited" },
			emailed: true,
		});
		expect(links.invite).toHaveBeenCalledWith(invite);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ to: "ana@ktb.test" });
		expect(sent[0]!.subject).toContain("Dra. Bia");
		expect(sent[0]!.text).toContain("Ana's consultations");
		expect(sent[0]!.text).toContain("https://app.ktb.test/portal/login");
	});

	it("writes the email in the acting user's locale", async () => {
		mocks.getLocale.mockReturnValue("pt-BR");
		await invitePatientFn({ data: invite });
		expect(sent[0]!.text).toContain("às consultas de Ana");
	});

	it("signs with the doctor's email when the profile has no name", async () => {
		mocks.getDoctorUser.mockResolvedValue({
			...acting,
			doctor: { name: null, email: "bia@ktb.test" },
		});
		await invitePatientFn({ data: invite });
		expect(sent[0]!.subject).toContain("bia@ktb.test");
	});

	it("still grants access, but says so, when this deployment sends no email", async () => {
		sender = null;
		await expect(invitePatientFn({ data: invite })).resolves.toMatchObject({
			ok: true,
			emailed: false,
		});
	});

	it("still grants access, but says so, when the delivery fails", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		sender = {
			send: async () => {
				throw new Error("smtp down");
			},
		};
		await expect(invitePatientFn({ data: invite })).resolves.toMatchObject({
			ok: true,
			emailed: false,
		});
		expect(logged).toHaveBeenCalledWith("patient invite email failed", expect.any(Error));
		logged.mockRestore();
	});

	it("falls back to an empty address for a link that carries none", async () => {
		links.invite.mockReturnValue(Effect.succeed({ id: 9, email: null, status: "active" }));
		await expect(invitePatientFn({ data: invite })).resolves.toMatchObject({
			link: { id: 9, email: "", status: "active" },
		});
	});

	it("reports a refused invite without sending anything", async () => {
		links.invite.mockReturnValue(Effect.fail(new PatientInviteRejected({ code: "invalid_email" })));
		await expect(invitePatientFn({ data: invite })).resolves.toEqual({
			ok: false,
			error: "invalid_email",
		});
		links.invite.mockReturnValue(denied);
		await expect(invitePatientFn({ data: invite })).resolves.toEqual({
			ok: false,
			error: "failed",
		});
		mocks.getDoctorUser.mockResolvedValue(null);
		await expect(invitePatientFn({ data: invite })).resolves.toEqual({
			ok: false,
			error: "failed",
		});
		expect(sent).toHaveLength(0);
	});

	it("rejects a malformed payload on the wire", async () => {
		await expect(invitePatientFn({ data: { patientId: "x" } })).rejects.toThrow();
	});
});

describe("approvePatientLinkFn / revokePatientLinkFn", () => {
	it("apply the change through the service", async () => {
		await expect(approvePatientLinkFn({ data: 7 })).resolves.toEqual({ ok: true });
		expect(links.approve).toHaveBeenCalledWith(7);
		links.revoke.mockReturnValue(Effect.succeed(false));
		await expect(revokePatientLinkFn({ data: 7 })).resolves.toEqual({ ok: false });
		expect(links.revoke).toHaveBeenCalledWith(7);
	});

	it("refuse denied changes and non-doctors", async () => {
		links.approve.mockReturnValue(denied);
		await expect(approvePatientLinkFn({ data: 7 })).resolves.toEqual({ ok: false });
		mocks.getDoctorUser.mockResolvedValue(null);
		await expect(revokePatientLinkFn({ data: 7 })).resolves.toEqual({ ok: false });
	});
});

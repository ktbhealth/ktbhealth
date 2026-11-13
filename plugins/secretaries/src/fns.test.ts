import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";

import { Forbidden } from "@ktb/authz";
import { Email } from "@ktb/email";

const mocks = vi.hoisted(() => ({
	getDoctorContext: vi.fn(),
	getLocale: vi.fn(() => "en"),
	getSessionUser: vi.fn(),
	run: vi.fn(),
	runAs: vi.fn(),
	list: vi.fn(),
	invite: vi.fn(),
	revoke: vi.fn(),
	send: vi.fn(),
	emailService: { current: "sender" as "sender" | "disabled" | "absent" },
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
	getRequestUrl: () => new URL("https://app.ktb.test/secretaries"),
}));
vi.mock("@ktb/server-fns", () => ({
	getDoctorContext: mocks.getDoctorContext,
	getLocale: mocks.getLocale,
	getSessionUser: mocks.getSessionUser,
	run: mocks.run,
	runAs: mocks.runAs,
}));

import { InviteRejected, Secretaries } from "./index.ts";
import {
	inviteSecretaryFn,
	listSecretariesFn,
	localeFn,
	revokeSecretaryFn,
	sessionUserFn,
} from "./fns.ts";

const user = { id: "doc", email: "doc@ktb.test", name: "Ana" };
const row = {
	id: 3,
	doctorId: 1,
	userId: null,
	email: "sec@ktb.test",
	role: "secretary",
	status: "invited",
};
const context = {
	user,
	profiles: [
		{ doctorId: 1, userId: "doc", email: "doc@ktb.test", displayName: "Dra. Ana", role: "owner" },
	],
	active: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getLocale.mockReturnValue("en");
	mocks.emailService.current = "sender";
	mocks.send.mockResolvedValue(undefined);
	const service = { list: mocks.list, invite: mocks.invite, revoke: mocks.revoke };
	mocks.runAs.mockImplementation(
		(_user: unknown, effect: Effect.Effect<unknown, never, Secretaries>) =>
			Effect.runPromise(effect.pipe(Effect.provideService(Secretaries, service))),
	);
	// `run` resolves the optional Email service like the app runtime would.
	mocks.run.mockImplementation((effect: Effect.Effect<unknown, never, Email>) =>
		Effect.runPromise(
			mocks.emailService.current === "absent"
				? (effect as Effect.Effect<unknown>)
				: effect.pipe(
						Effect.provideService(
							Email,
							mocks.emailService.current === "sender" ? { send: mocks.send } : null,
						),
					),
		),
	);
});

describe("session and locale fns", () => {
	it("return the session user and the active locale", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		await expect(sessionUserFn()).resolves.toBe(user);
		mocks.getLocale.mockReturnValue("pt-BR");
		await expect(localeFn()).resolves.toBe("pt-BR");
	});
});

describe("listSecretariesFn", () => {
	it("is null for anonymous visitors", async () => {
		mocks.getSessionUser.mockResolvedValue(null);
		await expect(listSecretariesFn()).resolves.toBeNull();
		expect(mocks.runAs).not.toHaveBeenCalled();
	});

	it("lists the session doctor's secretaries as plain items", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		mocks.list.mockReturnValue(Effect.succeed([row]));
		await expect(listSecretariesFn()).resolves.toEqual([
			{ id: 3, email: "sec@ktb.test", status: "invited" },
		]);
		expect(mocks.runAs.mock.calls[0]![0]).toBe(user);
	});

	it("is null for an account with no doctor profile of its own", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		mocks.list.mockReturnValue(Effect.fail(new Forbidden({ path: "secretary.read" })));
		await expect(listSecretariesFn()).resolves.toBeNull();
	});
});

describe("inviteSecretaryFn", () => {
	const invite = (email = "sec@ktb.test") => inviteSecretaryFn({ data: { email } });

	it("invites and emails the invitee in the doctor's name and locale", async () => {
		mocks.getDoctorContext.mockResolvedValue(context);
		mocks.getLocale.mockReturnValue("pt-BR");
		mocks.invite.mockReturnValue(Effect.succeed(row));
		await expect(invite()).resolves.toEqual({
			ok: true,
			secretary: { id: 3, email: "sec@ktb.test", status: "invited" },
		});
		expect(mocks.invite).toHaveBeenCalledWith("sec@ktb.test");
		const sent = mocks.send.mock.calls[0]![0] as { to: string; subject: string; text: string };
		expect(sent.to).toBe("sec@ktb.test");
		expect(sent.subject).toBe("Dra. Ana convidou você para o KTB Health");
		expect(sent.text).toContain("https://app.ktb.test/login");
	});

	it("names the doctor by email when they have no profile entry", async () => {
		mocks.getDoctorContext.mockResolvedValue({ ...context, profiles: [] });
		mocks.invite.mockReturnValue(Effect.succeed(row));
		await invite();
		expect((mocks.send.mock.calls[0]![0] as { subject: string }).subject).toBe(
			"doc@ktb.test invited you to KTB Health",
		);
	});

	it.each(["disabled", "absent"] as const)(
		"succeeds without sending when email is %s",
		async (mode) => {
			mocks.emailService.current = mode;
			mocks.getDoctorContext.mockResolvedValue(context);
			mocks.invite.mockReturnValue(Effect.succeed(row));
			await expect(invite()).resolves.toMatchObject({ ok: true });
			expect(mocks.send).not.toHaveBeenCalled();
		},
	);

	it("still succeeds when the email delivery fails", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.getDoctorContext.mockResolvedValue(context);
		mocks.invite.mockReturnValue(Effect.succeed(row));
		mocks.send.mockRejectedValue(new Error("bounced"));
		await expect(invite()).resolves.toMatchObject({ ok: true });
		expect(errors).toHaveBeenCalledWith("secretary invite email failed", expect.any(Error));
		errors.mockRestore();
	});

	it("returns the rejection code and sends nothing", async () => {
		mocks.getDoctorContext.mockResolvedValue(context);
		mocks.invite.mockReturnValue(Effect.fail(new InviteRejected({ code: "self" })));
		await expect(invite("doc@ktb.test")).resolves.toEqual({ ok: false, error: "self" });
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it("fails generically for non-doctors and anonymous callers", async () => {
		mocks.getDoctorContext.mockResolvedValue(context);
		mocks.invite.mockReturnValue(Effect.fail(new Forbidden({ path: "secretary.invite" })));
		await expect(invite()).resolves.toEqual({ ok: false, error: "failed" });
		mocks.getDoctorContext.mockResolvedValue(null);
		await expect(invite()).resolves.toEqual({ ok: false, error: "failed" });
	});

	it("rejects a malformed payload on the wire", async () => {
		await expect(inviteSecretaryFn({ data: { email: 1 } as never })).rejects.toThrow();
	});
});

describe("revokeSecretaryFn", () => {
	it("revokes the session doctor's delegation", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		mocks.revoke.mockReturnValue(Effect.succeed(true));
		await expect(revokeSecretaryFn({ data: 3 })).resolves.toEqual({ ok: true });
		expect(mocks.revoke).toHaveBeenCalledWith(3);
	});

	it("reports failure for foreign rows, non-doctors and anonymous callers", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		mocks.revoke.mockReturnValue(Effect.succeed(false));
		await expect(revokeSecretaryFn({ data: 3 })).resolves.toEqual({ ok: false });
		mocks.revoke.mockReturnValue(Effect.fail(new Forbidden({ path: "secretary.revoke" })));
		await expect(revokeSecretaryFn({ data: 3 })).resolves.toEqual({ ok: false });
		mocks.getSessionUser.mockResolvedValue(null);
		await expect(revokeSecretaryFn({ data: 3 })).resolves.toEqual({ ok: false });
	});
});

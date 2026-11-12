import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";

const mocks = vi.hoisted(() => ({
	getLocale: vi.fn(),
	getPatientContext: vi.fn(),
	getSessionUser: vi.fn(),
	runAs: vi.fn(),
	setPatientSelection: vi.fn(),
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
vi.mock("@ktb/server-fns", () => mocks);

import { Forbidden } from "@ktb/authz";

import { CpfRejected, PatientPortal } from "./index.ts";
import { localeFn, portalConsultationFn, portalFn, selectPatientFn, setCpfFn } from "./fns.ts";

const user = { id: "ana", email: "ana@ktb.test", name: "Ana" };
const me = { patientId: 1, name: "Ana", relation: "self" };
const kid = { patientId: 2, name: "Leo", relation: "guardian" };
const profile = { patientId: 1, relation: "self", name: "Ana", doctorName: "Dra. Bia" };
const listed = [{ id: 10, createdAt: new Date(0), chiefComplaint: "Dor de cabeça" }];
const consultation = {
	id: 10,
	createdAt: new Date(0),
	patientId: 1,
	patientName: "Ana",
	doctorName: "Dra. Bia",
	sections: [{ key: "conduta", content: "Retorno em 15 dias" }],
};

const portal = {
	profile: vi.fn(),
	consultations: vi.fn(),
	consultation: vi.fn(),
	hasCpf: vi.fn(),
	setCpf: vi.fn(),
};
const denied = Effect.fail(new Forbidden({ path: "portal.read" }));

beforeEach(() => {
	vi.clearAllMocks();
	// runAs executes the program against the PatientPortal stub.
	mocks.runAs.mockImplementation(
		(_user: unknown, effect: Effect.Effect<unknown, unknown, PatientPortal>) =>
			Effect.runPromise(effect.pipe(Effect.provideService(PatientPortal, portal as never))),
	);
	portal.profile.mockReturnValue(Effect.succeed(profile));
	portal.consultations.mockReturnValue(Effect.succeed(listed));
	portal.consultation.mockReturnValue(Effect.succeed(consultation));
	portal.hasCpf.mockReturnValue(Effect.succeed(true));
	portal.setCpf.mockReturnValue(Effect.void);
});

describe("localeFn", () => {
	it("returns the request's active locale", async () => {
		mocks.getLocale.mockReturnValue("pt-BR");
		await expect(localeFn()).resolves.toBe("pt-BR");
	});
});

describe("portalFn", () => {
	it("is null for anonymous visitors", async () => {
		mocks.getPatientContext.mockResolvedValue(null);
		await expect(portalFn()).resolves.toBeNull();
		expect(mocks.runAs).not.toHaveBeenCalled();
	});

	it("syncs the links, then loads the open record with its consultations", async () => {
		mocks.getPatientContext.mockResolvedValue({ user, profiles: [me, kid], active: me });
		await expect(portalFn()).resolves.toEqual({
			user: { name: "Ana", email: "ana@ktb.test" },
			hasCpf: true,
			profiles: [me, kid],
			profile,
			consultations: listed,
		});
		expect(mocks.getPatientContext).toHaveBeenCalledWith(undefined, { syncLinks: true });
		expect(mocks.runAs).toHaveBeenCalledWith(user, expect.anything());
		expect(portal.profile).toHaveBeenCalledWith(1);
		expect(portal.consultations).toHaveBeenCalledWith(1);
	});

	it("opens nothing while a profile choice is pending", async () => {
		mocks.getPatientContext.mockResolvedValue({ user, profiles: [me, kid], active: null });
		portal.hasCpf.mockReturnValue(Effect.succeed(false));
		await expect(portalFn()).resolves.toEqual({
			user: { name: "Ana", email: "ana@ktb.test" },
			hasCpf: false,
			profiles: [me, kid],
			profile: null,
			consultations: [],
		});
		expect(portal.profile).not.toHaveBeenCalled();
		expect(portal.consultations).not.toHaveBeenCalled();
	});

	it("shows an empty portal when the link was revoked mid-request", async () => {
		mocks.getPatientContext.mockResolvedValue({ user, profiles: [me], active: me });
		portal.profile.mockReturnValue(denied);
		await expect(portalFn()).resolves.toEqual({
			user: { name: "Ana", email: "ana@ktb.test" },
			hasCpf: true,
			profiles: [],
			profile: null,
			consultations: [],
		});
	});
});

describe("portalConsultationFn", () => {
	it("tells anonymous visitors apart so the route can send them to sign in", async () => {
		mocks.getSessionUser.mockResolvedValue(null);
		await expect(portalConsultationFn({ data: 10 })).resolves.toEqual({ status: "anonymous" });
		expect(mocks.runAs).not.toHaveBeenCalled();
	});

	it("returns the consultation as the session user may see it", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		await expect(portalConsultationFn({ data: 10 })).resolves.toEqual({
			status: "ok",
			consultation,
		});
		expect(mocks.runAs).toHaveBeenCalledWith(user, expect.anything());
		expect(portal.consultation).toHaveBeenCalledWith(10);
	});

	it("reports a consultation the user may not see as missing", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		portal.consultation.mockReturnValue(denied);
		await expect(portalConsultationFn({ data: 30 })).resolves.toEqual({ status: "missing" });
	});

	it("rejects a non-numeric id on the wire", async () => {
		await expect(portalConsultationFn({ data: "x" as never })).rejects.toThrow();
	});
});

describe("selectPatientFn", () => {
	it("stores a profile the user holds", async () => {
		mocks.getPatientContext.mockResolvedValue({ user, profiles: [me, kid], active: me });
		await expect(selectPatientFn({ data: 2 })).resolves.toEqual({ ok: true });
		expect(mocks.setPatientSelection).toHaveBeenCalledWith(2);
	});

	it("refuses a profile the user does not hold, and anonymous callers", async () => {
		mocks.getPatientContext.mockResolvedValue({ user, profiles: [me], active: me });
		await expect(selectPatientFn({ data: 2 })).resolves.toEqual({ ok: false });
		mocks.getPatientContext.mockResolvedValue(null);
		await expect(selectPatientFn({ data: 1 })).resolves.toEqual({ ok: false });
		expect(mocks.setPatientSelection).not.toHaveBeenCalled();
	});
});

describe("setCpfFn", () => {
	it("stores the session user's CPF", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		await expect(setCpfFn({ data: "529.982.247-25" })).resolves.toEqual({ ok: true });
		expect(portal.setCpf).toHaveBeenCalledWith("529.982.247-25");
	});

	it("reports why a CPF was refused", async () => {
		mocks.getSessionUser.mockResolvedValue(user);
		portal.setCpf.mockReturnValue(Effect.fail(new CpfRejected({ code: "cpf_taken" })));
		await expect(setCpfFn({ data: "529.982.247-25" })).resolves.toEqual({
			ok: false,
			error: "cpf_taken",
		});
	});

	it("fails for anonymous callers and anyone acting for a doctor", async () => {
		mocks.getSessionUser.mockResolvedValue(null);
		await expect(setCpfFn({ data: "529.982.247-25" })).resolves.toEqual({
			ok: false,
			error: "failed",
		});
		mocks.getSessionUser.mockResolvedValue(user);
		portal.setCpf.mockReturnValue(Effect.fail(new Forbidden({ path: "portal.update" })));
		await expect(setCpfFn({ data: "529.982.247-25" })).resolves.toEqual({
			ok: false,
			error: "failed",
		});
	});
});

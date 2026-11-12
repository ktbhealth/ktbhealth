import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";

const mocks = vi.hoisted(() => ({
	ensureSessionUser: vi.fn(),
	getDoctorContext: vi.fn(),
	getLocale: vi.fn(),
	runAs: vi.fn(),
	setDoctorSelection: vi.fn(),
	ensureProfile: vi.fn(),
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

import { Doctors } from "./index.ts";
import { doctorContextFn, ensureDoctorProfileFn, localeFn, selectDoctorFn } from "./fns.ts";

const own = {
	doctorId: 1,
	userId: "u1",
	email: "u1@ktb.test",
	displayName: "Dra. Ana",
	role: "owner",
};
const delegated = {
	doctorId: 2,
	userId: "doc",
	email: "doc@ktb.test",
	displayName: "Dr. Leo",
	role: "secretary",
};

beforeEach(() => {
	vi.clearAllMocks();
	// runAs executes the program against a Doctors stub.
	mocks.runAs.mockImplementation(
		(_user: unknown, effect: Effect.Effect<unknown, unknown, Doctors>) =>
			Effect.runPromise(
				effect.pipe(Effect.provideService(Doctors, { ensureProfile: mocks.ensureProfile })),
			),
	);
});

describe("localeFn", () => {
	it("returns the request's active locale", async () => {
		mocks.getLocale.mockReturnValue("pt-BR");
		await expect(localeFn()).resolves.toBe("pt-BR");
	});
});

describe("doctorContextFn", () => {
	it("is null for anonymous visitors", async () => {
		mocks.getDoctorContext.mockResolvedValue(null);
		await expect(doctorContextFn()).resolves.toBeNull();
	});

	it("claims invites and returns the profiles without account details", async () => {
		mocks.getDoctorContext.mockResolvedValue({ profiles: [own, delegated], active: own });
		await expect(doctorContextFn()).resolves.toEqual({
			profiles: [
				{ doctorId: 1, displayName: "Dra. Ana", role: "owner" },
				{ doctorId: 2, displayName: "Dr. Leo", role: "secretary" },
			],
			activeDoctorId: 1,
		});
		expect(mocks.getDoctorContext).toHaveBeenCalledWith(undefined, { claimInvites: true });
	});

	it("reports no active profile while a choice is pending", async () => {
		mocks.getDoctorContext.mockResolvedValue({ profiles: [], active: null });
		await expect(doctorContextFn()).resolves.toEqual({ profiles: [], activeDoctorId: null });
	});
});

describe("selectDoctorFn", () => {
	it("stores a profile the user holds", async () => {
		mocks.getDoctorContext.mockResolvedValue({ profiles: [own, delegated], active: own });
		await expect(selectDoctorFn({ data: 2 })).resolves.toEqual({ ok: true });
		expect(mocks.setDoctorSelection).toHaveBeenCalledWith(2);
	});

	it("refuses a profile the user does not hold, and anonymous callers", async () => {
		mocks.getDoctorContext.mockResolvedValue({ profiles: [own], active: own });
		await expect(selectDoctorFn({ data: 2 })).resolves.toEqual({ ok: false });
		mocks.getDoctorContext.mockResolvedValue(null);
		await expect(selectDoctorFn({ data: 1 })).resolves.toEqual({ ok: false });
		expect(mocks.setDoctorSelection).not.toHaveBeenCalled();
	});

	it("rejects a non-numeric id on the wire", async () => {
		await expect(selectDoctorFn({ data: "x" as never })).rejects.toThrow();
	});
});

describe("ensureDoctorProfileFn", () => {
	it("creates the session user's profile under their name and acts as it", async () => {
		mocks.ensureSessionUser.mockResolvedValue({ id: "u1", email: "u1@ktb.test", name: "Ana" });
		mocks.ensureProfile.mockReturnValue(Effect.succeed({ id: 7 }));
		await expect(ensureDoctorProfileFn()).resolves.toEqual({ ok: true });
		expect(mocks.ensureProfile).toHaveBeenCalledWith("Ana");
		expect(mocks.setDoctorSelection).toHaveBeenCalledWith(7);
	});

	it("falls back to the email when the account has no name", async () => {
		mocks.ensureSessionUser.mockResolvedValue({ id: "u1", email: "u1@ktb.test", name: null });
		mocks.ensureProfile.mockReturnValue(Effect.succeed({ id: 7 }));
		await ensureDoctorProfileFn();
		expect(mocks.ensureProfile).toHaveBeenCalledWith("u1@ktb.test");
	});

	it("propagates the missing session", async () => {
		mocks.ensureSessionUser.mockRejectedValue(new Error("unauthenticated"));
		await expect(ensureDoctorProfileFn()).rejects.toThrow("unauthenticated");
		expect(mocks.runAs).not.toHaveBeenCalled();
	});
});

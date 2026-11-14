import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSessionUser: vi.fn(),
	getDoctorAccess: vi.fn(),
}));

// Same fake as the host's route tests: the handler runs as a plain async fn.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const chain = {
			validator: () => chain,
			handler: (h: (arg?: unknown) => unknown) => async (arg?: unknown) => h(arg ?? {}),
		};
		return chain;
	},
}));
vi.mock("@ktb/server-fns", async (importOriginal) => ({
	...(await importOriginal<typeof import("@ktb/server-fns")>()),
	getSessionUser: mocks.getSessionUser,
	getDoctorAccess: mocks.getDoctorAccess,
}));

import { doctorAccessFn, sessionUserFn } from "./fns.ts";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("session server fns", () => {
	it("sessionUserFn returns the signed-in user", async () => {
		const user = { id: "u1", email: "a@x.com", name: "A" };
		mocks.getSessionUser.mockResolvedValue(user);
		await expect(sessionUserFn()).resolves.toBe(user);
	});

	it("doctorAccessFn returns the request's doctor-side standing", async () => {
		mocks.getDoctorAccess.mockResolvedValue("anonymous");
		await expect(doctorAccessFn()).resolves.toBe("anonymous");
	});
});

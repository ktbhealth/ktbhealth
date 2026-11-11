import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSessionUser: vi.fn(),
	getLocale: vi.fn(),
	sessionUserFn: vi.fn(),
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
vi.mock("@ktb/server-fns", () => ({
	ensureSessionUser: vi.fn(),
	getLocale: mocks.getLocale,
	getServerRuntime: vi.fn(),
	getSessionUser: mocks.getSessionUser,
	purgeAudio: vi.fn(),
	runAs: vi.fn(),
}));

import { localeFn, sessionUserFn } from "./fns.ts";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("session and locale server fns", () => {
	it("sessionUserFn returns the signed-in user", async () => {
		const user = { id: "u1", email: "a@x.com", name: "A" };
		mocks.getSessionUser.mockResolvedValue(user);
		await expect(sessionUserFn()).resolves.toBe(user);
	});

	it("sessionUserFn returns null for anonymous visitors", async () => {
		mocks.getSessionUser.mockResolvedValue(null);
		await expect(sessionUserFn()).resolves.toBeNull();
	});

	it("localeFn returns the request's active locale", async () => {
		mocks.getLocale.mockReturnValue("pt-BR");
		await expect(localeFn()).resolves.toBe("pt-BR");
	});
});

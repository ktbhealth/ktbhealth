import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getLocale: vi.fn(),
}));

// Same fake as the other plugins' route tests: the handler runs as a
// plain async fn.
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
	getLocale: mocks.getLocale,
}));

import { localeFn } from "./fns.ts";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("localeFn", () => {
	it("returns the request's active locale", async () => {
		mocks.getLocale.mockReturnValue("pt-BR");
		await expect(localeFn()).resolves.toBe("pt-BR");
	});
});

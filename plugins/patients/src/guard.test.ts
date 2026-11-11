import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	sessionUserFn: vi.fn<() => Promise<{ id: string } | null>>(),
}));

vi.mock("./fns.ts", () => ({ sessionUserFn: mocks.sessionUserFn }));

import { isRedirect } from "@tanstack/react-router";

import { requireSession } from "./guard.ts";

describe("requireSession", () => {
	it("passes for a signed-in user", async () => {
		mocks.sessionUserFn.mockResolvedValue({ id: "u1" });
		await expect(requireSession()).resolves.toBeUndefined();
	});

	it("redirects anonymous visitors to /login", async () => {
		mocks.sessionUserFn.mockResolvedValue(null);
		const caught = await requireSession().catch((e: unknown) => e);
		expect(isRedirect(caught)).toBe(true);
		// redirect() returns a Response carrying the navigation options.
		expect((caught as Response & { options: { to: string } }).options.to).toBe("/login");
	});
});

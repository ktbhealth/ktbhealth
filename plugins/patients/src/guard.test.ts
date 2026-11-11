import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionUserFn = vi.hoisted(() => vi.fn());
vi.mock("./fns.ts", () => ({ sessionUserFn }));

import { requireSession } from "./guard.ts";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("requireSession", () => {
	it("lets a signed-in user through", async () => {
		sessionUserFn.mockResolvedValue({ id: "u1" });
		await expect(requireSession()).resolves.toBeUndefined();
	});

	it("redirects anonymous visitors to /login", async () => {
		sessionUserFn.mockResolvedValue(null);
		await expect(requireSession()).rejects.toMatchObject({ options: { to: "/login" } });
	});
});

import * as Context from "effect/Context";
import { describe, expect, it } from "vitest";

import { Auth, type Session } from "./index.ts";

describe("auth port", () => {
	it("Auth service tag can be provided in an Effect context", async () => {
		expect(Auth).toBeDefined();

		const mockSession: Session = {
			user: { id: "u-1", email: "dr@example.com", name: "Dra. Ana" },
			sessionId: "s-1",
			expiresAt: new Date(),
		};

		const ctx = Context.make(Auth, {
			getSession: async () => mockSession,
			setUserBanned: async () => {},
		});

		const authService = Context.get(ctx, Auth);
		const s = await authService.getSession(new Headers());
		expect(s).toBe(mockSession);
	});
});

import { describe, expect, it } from "vitest";

import { authClient } from "./client.ts";

describe("authClient", () => {
	it("exposes better-auth client methods", () => {
		expect(authClient).toBeDefined();
		expect(typeof authClient.signIn.email).toBe("function");
		expect(typeof authClient.signUp.email).toBe("function");
		expect(typeof authClient.useSession).toBe("function");
	});
});

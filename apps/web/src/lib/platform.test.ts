import { describe, expect, it } from "vitest";

import { ai, auth, BindingLive, db } from "./platform.ts";

describe("platform", () => {
	it("exposes db, auth and ai bindings", async () => {
		expect(db).toBeDefined();
		expect(auth).toBeDefined();
		expect(typeof auth.api.getSession).toBe("function");
		expect(ai?.run).toBeDefined();
		expect(BindingLive).toBeDefined();
	});
});

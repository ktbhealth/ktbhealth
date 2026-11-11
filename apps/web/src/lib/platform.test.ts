import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { ai, auth, BindingLive, db, runAs } from "./platform.ts";

describe("platform", () => {
	it("exposes db, auth and ai bindings", async () => {
		expect(db).toBeDefined();
		expect(auth).toBeDefined();
		expect(typeof auth.api.getSession).toBe("function");
		expect(ai?.run).toBeDefined();
		expect(BindingLive).toBeDefined();
	});

	it("runAs forwards an explicit tenant selector to the app runtime", async () => {
		await expect(runAs({ id: "u1" }, Effect.succeed("ok"), { slug: "clinic-a" })).resolves.toBe(
			"ok",
		);
		await expect(runAs({ id: "u1" }, Effect.succeed("ok"), null)).resolves.toBe("ok");
	});

	it("runAs without a selector degrades to personal scope outside a request", async () => {
		await expect(runAs({ id: "u1" }, Effect.succeed("ok"))).resolves.toBe("ok");
	});
});

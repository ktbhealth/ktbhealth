import { describe, expect, it } from "vitest";

import { plugins, authRoutesPlugin, authChromePlugin } from "./index.ts";

describe("auth plugin manifests", () => {
	it("auth.routes is a system plugin mounting login + the /api subtree", () => {
		expect(authRoutesPlugin.id).toBe("auth.routes");
		expect(authRoutesPlugin.system).toBe(true);
		expect(authRoutesPlugin.routes).toHaveLength(2);
	});

	it("auth.chrome is a system plugin contributing the session menu", () => {
		expect(authChromePlugin.id).toBe("auth.chrome");
		expect(authChromePlugin.system).toBe(true);
		expect(authChromePlugin.chrome).toHaveLength(1);
		expect(authChromePlugin.chrome[0]).toMatchObject({
			region: "app.header.session",
			content: { kind: "component" },
		});
	});

	it("exports the discovery plugins array in order", () => {
		expect(plugins.map((p) => p.id)).toEqual(["auth.routes", "auth.chrome"]);
	});
});

import { describe, expect, it } from "vitest";

import { plugins, sessionChromePlugin } from "./index.ts";

describe("session chrome plugin", () => {
	it("declares the session menu in app.header.session", () => {
		expect(sessionChromePlugin.id).toBe("session.chrome");
		expect(sessionChromePlugin.chrome).toHaveLength(1);
		expect(sessionChromePlugin.chrome[0]).toMatchObject({
			region: "app.header.session",
			content: { kind: "component" },
		});
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["session.chrome"]);
	});
});

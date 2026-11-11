import { describe, expect, it } from "vitest";

import { plugins, siteChromePlugin } from "./index.ts";

describe("site chrome plugin", () => {
	it("declares the app-shell chrome regions", () => {
		expect(siteChromePlugin.id).toBe("site.chrome");
		expect(siteChromePlugin.chrome.map((c) => c.region)).toEqual([
			"app.header.brand",
			"app.header.actions",
			"app.footer.note",
		]);
		const note = siteChromePlugin.chrome.find((c) => c.region === "app.footer.note");
		expect(note?.content).toMatchObject({ kind: "note", key: "disclaimer" });
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["site.chrome"]);
	});
});

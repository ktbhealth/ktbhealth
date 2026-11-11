import { describe, expect, it } from "vitest";

import { enabledIdSet, enabledPlugins, packageEnabled } from "./plugin-state.ts";

describe("enabledIdSet", () => {
	it("wraps the wire array in a set", () => {
		const set = enabledIdSet({ enabled: ["a", "b"] });
		expect(set.has("a")).toBe(true);
		expect(set.has("c")).toBe(false);
		expect(set.size).toBe(2);
	});
});

describe("enabledPlugins", () => {
	it("keeps only enabled ids, preserving order", () => {
		const plugins = [{ id: "a" }, { id: "b" }, { id: "c" }];
		expect(enabledPlugins(plugins, new Set(["c", "a"])).map((p) => p.id)).toEqual(["a", "c"]);
		expect(enabledPlugins(plugins, new Set())).toEqual([]);
	});
});

describe("packageEnabled", () => {
	it("matches any plugin id under the package prefix", () => {
		const enabled = new Set(["consultations.api", "patients.web"]);
		expect(packageEnabled(enabled, "consultations")).toBe(true);
		expect(packageEnabled(enabled, "notifications")).toBe(false);
		// Prefix must be dot-terminated — "consultationsx" must not match.
		expect(packageEnabled(new Set(["consultationsx.y"]), "consultations")).toBe(false);
	});
});

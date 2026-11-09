import { describe, expect, it } from "vitest";

import type { Plugin } from "@ktb/kernel";
import { discoverPlugins, orderPlugins } from "./index.ts";

// Dep ids are checked against PluginRegistry at compile time; the test
// program declares the ids it uses so the fixtures typecheck.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		a: true;
		b: true;
		c: true;
		d: true;
		ghost: true;
	}
}

const p = (
	id: string,
	requiredDeps?: Plugin["requiredDeps"],
	optionalDeps?: Plugin["optionalDeps"],
): Plugin => ({ id, requiredDeps, optionalDeps });

describe("discoverPlugins", () => {
	it("keeps only modules exporting a plugin-shaped value", () => {
		const plugins = discoverPlugins({
			"./patients.ts": { plugin: p("patients") },
			"./random.ts": { something: 1 },
			"./broken.ts": { plugin: { noId: true } },
			"./null.ts": null,
		});
		expect(plugins.map((x) => x.id)).toEqual(["patients"]);
	});
});

describe("orderPlugins", () => {
	it("topologically sorts by requiredDeps", () => {
		const ordered = orderPlugins([p("c", ["b"]), p("a"), p("b", ["a"])]);
		expect(ordered.map((x) => x.id)).toEqual(["a", "b", "c"]);
	});

	it("orders by optionalDeps when the dep is present", () => {
		const ordered = orderPlugins([p("a", undefined, ["b"]), p("b")]);
		expect(ordered.map((x) => x.id)).toEqual(["b", "a"]);
	});

	it("ignores optionalDeps that resolve to no plugin", () => {
		const ordered = orderPlugins([p("a", undefined, ["ghost"]), p("b")]);
		expect(ordered.map((x) => x.id)).toContain("a");
	});

	it("throws on unknown requiredDep", () => {
		expect(() => orderPlugins([p("a", ["ghost"])])).toThrow(
			'plugin "a" requires unknown plugin "ghost"',
		);
	});

	it("throws on duplicate plugin id", () => {
		expect(() => orderPlugins([p("a"), p("a")])).toThrow('duplicate plugin id "a"');
	});

	it("throws on dependency cycle", () => {
		expect(() => orderPlugins([p("a", ["b"]), p("b", ["a"])])).toThrow(
			"Cannot perform topological sort on cyclic graph",
		);
	});
});

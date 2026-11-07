import { describe, expect, it } from "vitest";

import type { Plugin } from "@ktb/kernel";
import { discoverPlugins, orderPlugins } from "./index.ts";

const p = (id: string, deps?: string[]): Plugin => ({ id, deps });

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
	it("topologically sorts by deps", () => {
		const ordered = orderPlugins([p("c", ["b"]), p("a"), p("b", ["a"])]);
		expect(ordered.map((x) => x.id)).toEqual(["a", "b", "c"]);
	});

	it("throws on unknown dep", () => {
		expect(() => orderPlugins([p("a", ["ghost"])])).toThrow('unknown plugin "ghost"');
	});

	it("throws on dependency cycle", () => {
		expect(() => orderPlugins([p("a", ["b"]), p("b", ["a"])])).toThrow(
			"Cannot perform topological sort on cyclic graph",
		);
	});
});

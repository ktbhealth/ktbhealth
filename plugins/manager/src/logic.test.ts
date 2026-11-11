import { describe, expect, it } from "vitest";

import { definePlugin, type Plugin, type PluginConfigSchema, type PluginId } from "@ktb/kernel";
import * as Layer from "effect/Layer";

import {
	configFormFields,
	contributionKinds,
	dependentClosure,
	disabledClosure,
	missingRequiredDeps,
	pluginDisplayName,
	requiredClosure,
} from "./logic.ts";

declare module "@ktb/kernel" {
	interface PluginRegistry {
		"t.a": true;
		"t.b": true;
		"t.c": true;
		"t.d": true;
		"t.chrome": true;
		"t.panel": true;
		"t.tables": true;
		"t.services": true;
		"t.routes": true;
		"t.landing": true;
	}
}

const dep = (id: string, deps: readonly string[] = []) =>
	definePlugin({ id, requiredDeps: deps as unknown as readonly PluginId[] });

// a ← b ← c chain; d independent.
const plugins: readonly Plugin[] = [
	dep("t.a"),
	dep("t.b", ["t.a"]),
	dep("t.c", ["t.b"]),
	dep("t.d"),
];

describe("pluginDisplayName", () => {
	it("prefers meta.name, falls back to id", () => {
		expect(pluginDisplayName({ id: "x", meta: { name: "X" } })).toBe("X");
		expect(pluginDisplayName({ id: "x.y" })).toBe("x.y");
		expect(pluginDisplayName({ id: "x", meta: {} })).toBe("x");
	});
});

describe("contributionKinds", () => {
	it("lists the contribution fields a plugin carries", () => {
		expect(contributionKinds(dep("t.a"))).toEqual([]);
		expect(
			contributionKinds(
				definePlugin({
					id: "t.chrome",
					chrome: [
						{
							id: "c",
							region: "console.sidebar",
							content: { kind: "link", to: "/x", label: "X" },
						},
					],
				}),
			),
		).toEqual(["chrome"]);
		expect(contributionKinds(definePlugin({ id: "t.tables", tables: {} }))).toEqual(["tables"]);
		expect(contributionKinds(definePlugin({ id: "t.panel", panel: {} }))).toEqual(["panel"]);
		expect(contributionKinds(definePlugin({ id: "t.routes", routes: [] }))).toEqual(["routes"]);
		expect(contributionKinds(definePlugin({ id: "t.services", services: Layer.empty }))).toEqual([
			"services",
		]);
		expect(
			contributionKinds(definePlugin({ id: "t.landing", landing: { page: () => null } })),
		).toEqual(["landing"]);
	});
});

describe("missingRequiredDeps", () => {
	it("returns direct requiredDeps not in the enabled set", () => {
		const enabled = new Set(["t.a", "t.c", "t.d"]);
		// t.b requires t.a (enabled) → not missing.
		expect(missingRequiredDeps(plugins, enabled, "t.b")).toEqual([]);
		expect(missingRequiredDeps(plugins, new Set(["t.b", "t.c", "t.d"]), "t.b")).toEqual(["t.a"]);
		expect(missingRequiredDeps(plugins, enabled, "t.a")).toEqual([]);
		expect(missingRequiredDeps(plugins, enabled, "unknown")).toEqual([]);
	});
});

describe("dependentClosure / disabledClosure", () => {
	it("collects transitive dependents in registry order", () => {
		expect(dependentClosure(plugins, "t.a")).toEqual(["t.b", "t.c"]);
		expect(dependentClosure(plugins, "t.b")).toEqual(["t.c"]);
		expect(dependentClosure(plugins, "t.d")).toEqual([]);
		expect(disabledClosure(plugins, "t.a")).toEqual(["t.a", "t.b", "t.c"]);
		expect(disabledClosure(plugins, "t.d")).toEqual(["t.d"]);
	});

	it("handles diamonds without duplicates", () => {
		const diamond: readonly Plugin[] = [
			dep("t.a"),
			dep("t.b", ["t.a"]),
			dep("t.c", ["t.a"]),
			dep("t.d", ["t.b", "t.c"]),
		];
		expect(dependentClosure(diamond, "t.a")).toEqual(["t.b", "t.c", "t.d"]);
		expect(disabledClosure(diamond, "t.a")).toEqual(["t.a", "t.b", "t.c", "t.d"]);
	});
});

describe("requiredClosure", () => {
	it("walks requiredDeps transitively, deduplicated", () => {
		expect(requiredClosure(plugins, "t.c")).toEqual(["t.b", "t.a"]);
		expect(requiredClosure(plugins, "t.a")).toEqual([]);
	});
});

describe("configFormFields", () => {
	// Hand-written JSON-Schema documents — the form consumes plain JSON,
	// never the effect/Schema itself.
	const doc = (schema: Record<string, unknown>): PluginConfigSchema => ({
		schema: { dialect: "draft-2020-12", schema, definitions: {} },
	});

	it("projects scalar properties into form fields", () => {
		const fields = configFormFields(
			doc({
				type: "object",
				required: ["title"],
				properties: {
					title: { type: "string", title: "Title" },
					retries: { type: "integer", title: "Retries", default: 3 },
					verbose: { type: "boolean", default: false },
					mode: { type: "string", enum: ["a", "b"], default: "a" },
				},
			}),
		);
		expect(fields).toEqual([
			{ key: "title", label: "Title", type: "string", required: true },
			{ key: "retries", label: "Retries", type: "number", default: 3, required: false },
			{ key: "verbose", label: "verbose", type: "boolean", default: false, required: false },
			{
				key: "mode",
				label: "mode",
				type: "enum",
				options: ["a", "b"],
				default: "a",
				required: false,
			},
		]);
	});

	it("skips unsupported shapes (anyOf/oneOf/const/nested/arrays)", () => {
		const fields = configFormFields(
			doc({
				type: "object",
				properties: {
					ok: { type: "string" },
					wrapped: { anyOf: [{ type: "number" }, { type: "string" }] },
					choice: { oneOf: [{ const: "x" }, { const: "y" }] },
					nested: { type: "object", properties: { a: { type: "string" } } },
					list: { type: "array", items: { type: "string" } },
					numEnum: { type: "number", enum: [1, 2] },
				},
			}),
		);
		expect(fields.map((f) => f.key)).toEqual(["ok"]);
	});

	it("returns no fields for an empty or malformed document", () => {
		expect(configFormFields(doc({ type: "object" }))).toEqual([]);
		expect(
			configFormFields({ schema: { dialect: "draft-2020-12", schema: {}, definitions: {} } }),
		).toEqual([]);
	});
});

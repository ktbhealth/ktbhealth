import { describe, expect, it } from "vitest";

import { Db, makeDb } from "@ktb/db";
import { pluginState } from "@ktb/db/schema";
import { makeD1 } from "@ktb/db/testing";
import { definePlugin } from "@ktb/kernel";
import type { PluginConfigSchema, PluginId } from "@ktb/kernel";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { Schema, SchemaGetter } from "effect";

import {
	InvalidPluginConfig,
	makePluginStatesLive,
	pluginConfigDefaults,
	PluginDepsUnsatisfied,
	PluginStates,
	pluginEnabled,
	UnknownPlugin,
	validatePluginConfig,
} from "./plugin-states.ts";

const DDL = `
CREATE TABLE plugin_state (
	plugin_id TEXT PRIMARY KEY NOT NULL,
	enabled INTEGER DEFAULT true NOT NULL,
	config TEXT,
	updated_at INTEGER NOT NULL
);
`;

// Test-only ids registered for the PluginId type — the runtime registry
// is whatever `plugins` array the layer is built with.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"test.dep": true;
		"test.main": true;
		"test.other": true;
		"test.weird": true;
	}
}

const depPlugin = definePlugin({ id: "test.dep" });

// Config contract: the effect/Schema is the runtime validator
// (`configSchema`); `meta.config` carries its JSON-Schema projection —
// exactly what a real plugin manifest declares (see plugins/manager).
const mainConfigSchema = Schema.Struct({
	title: Schema.String.annotate({ title: "Title" }),
	retries: Schema.optionalKey(Schema.Finite).annotate({ title: "Retries", default: 3 }),
	verbose: Schema.optionalKey(Schema.Boolean).annotate({ title: "Verbose", default: false }),
	mode: Schema.optionalKey(Schema.Literals(["fast", "slow"])).annotate({
		title: "Mode",
		default: "fast",
	}),
});
const mainConfig: PluginConfigSchema = {
	schema: Schema.toJsonSchemaDocument(mainConfigSchema),
};

const mainPlugin = definePlugin({
	id: "test.main",
	requiredDeps: ["test.dep" as PluginId],
	meta: {
		name: "Main",
		config: mainConfig,
	},
	configSchema: mainConfigSchema,
});
const otherPlugin = definePlugin({ id: "test.other" });

const testPlugins = [depPlugin, mainPlugin, otherPlugin];

const makeRuntime = () => {
	const layer = makePluginStatesLive(testPlugins).pipe(
		Layer.provide(Layer.succeed(Db, makeDb(makeD1(DDL)))),
	);
	return ManagedRuntime.make(layer);
};

const withStates = <A>(
	runtime: ManagedRuntime.ManagedRuntime<PluginStates, never>,
	eff: Effect.Effect<A, unknown, PluginStates>,
) => runtime.runPromise(eff);

describe("PluginStatesLive", () => {
	it("defaults to enabled with schema-default config (no row)", async () => {
		const runtime = makeRuntime();
		try {
			await expect(
				withStates(
					runtime,
					Effect.flatMap(PluginStates, (s) => s.isEnabled("test.main")),
				),
			).resolves.toBe(true);
			const enabled = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.enabledIds()),
			);
			expect([...enabled].sort()).toEqual(["test.dep", "test.main", "test.other"]);
			const config = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.config("test.main")),
			);
			expect(config).toEqual({ retries: 3, verbose: false, mode: "fast" });
		} finally {
			await runtime.dispose();
		}
	});

	it("setEnabled upserts rows and enabledIds reflects them", async () => {
		const runtime = makeRuntime();
		try {
			await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["test.other"], false)),
			);
			await expect(
				withStates(
					runtime,
					Effect.flatMap(PluginStates, (s) => s.isEnabled("test.other")),
				),
			).resolves.toBe(false);
			const enabled = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.enabledIds()),
			);
			expect(enabled.has("test.other")).toBe(false);
			expect(enabled.has("test.dep")).toBe(true);
			// Re-enable restores it.
			await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["test.other"], true)),
			);
			await expect(
				withStates(
					runtime,
					Effect.flatMap(PluginStates, (s) => s.isEnabled("test.other")),
				),
			).resolves.toBe(true);
		} finally {
			await runtime.dispose();
		}
	});

	it("rejects unknown plugin ids", async () => {
		const runtime = makeRuntime();
		try {
			const exit = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["nope"], false)).pipe(Effect.flip),
			);
			expect(exit).toBeInstanceOf(UnknownPlugin);
		} finally {
			await runtime.dispose();
		}
	});

	it("enforces the requiredDeps invariant on writes", async () => {
		const runtime = makeRuntime();
		try {
			// Disabling the dep alone orphans test.main → rejected.
			const exit = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["test.dep"], false)).pipe(Effect.flip),
			);
			expect(exit).toBeInstanceOf(PluginDepsUnsatisfied);
			expect((exit as PluginDepsUnsatisfied).pluginId).toBe("test.main");
			expect((exit as PluginDepsUnsatisfied).missingDeps).toEqual(["test.dep"]);
			// A rejected write must not mutate state — the dep stays enabled.
			await expect(
				withStates(
					runtime,
					Effect.flatMap(PluginStates, (s) => s.isEnabled("test.dep")),
				),
			).resolves.toBe(true);
			// The cascade set (dep + dependent) is accepted.
			await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["test.dep", "test.main"], false)),
			);
			// Re-enabling the dependent while its dep is off → rejected.
			const exit2 = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["test.main"], true)).pipe(Effect.flip),
			);
			expect(exit2).toBeInstanceOf(PluginDepsUnsatisfied);
			// Enabling both together is fine.
			await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["test.dep", "test.main"], true)),
			);
		} finally {
			await runtime.dispose();
		}
	});

	it("setConfig validates against meta.config and merges defaults", async () => {
		const runtime = makeRuntime();
		try {
			await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) =>
					s.setConfig("test.main", { title: "Hello", retries: 5, mode: "slow" }),
				),
			);
			const config = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.config("test.main")),
			);
			expect(config).toEqual({ title: "Hello", retries: 5, verbose: false, mode: "slow" });
			// Wrong types are rejected.
			const bad = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) =>
					s.setConfig("test.main", { title: "T", retries: "x" }),
				).pipe(Effect.flip),
			);
			expect(bad).toBeInstanceOf(InvalidPluginConfig);
			expect((bad as InvalidPluginConfig).issues).toContain("retries: Expected number");
			// Missing required field is rejected.
			const missing = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setConfig("test.main", {})).pipe(Effect.flip),
			);
			expect(missing).toBeInstanceOf(InvalidPluginConfig);
			// Plugins without a config schema reject writes.
			const noSchema = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setConfig("test.other", {})).pipe(Effect.flip),
			);
			expect(noSchema).toBeInstanceOf(InvalidPluginConfig);
			// Unknown plugin id.
			const unknown = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.config("nope")).pipe(Effect.flip),
			);
			expect(unknown).toBeInstanceOf(UnknownPlugin);
		} finally {
			await runtime.dispose();
		}
	});

	it("entries returns every known plugin with resolved state", async () => {
		const runtime = makeRuntime();
		try {
			await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["test.other"], false)),
			);
			const entries = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.entries()),
			);
			expect(entries.map((e) => e.pluginId).sort()).toEqual([
				"test.dep",
				"test.main",
				"test.other",
			]);
			const other = entries.find((e) => e.pluginId === "test.other");
			expect(other?.enabled).toBe(false);
			const main = entries.find((e) => e.pluginId === "test.main");
			expect(main?.config).toEqual({ retries: 3, verbose: false, mode: "fast" });
		} finally {
			await runtime.dispose();
		}
	});

	it("pluginEnabled reads isEnabled through the service", async () => {
		const runtime = makeRuntime();
		try {
			await expect(withStates(runtime, pluginEnabled("test.main"))).resolves.toBe(true);
			await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setEnabled(["test.other"], false)),
			);
			await expect(withStates(runtime, pluginEnabled("test.other"))).resolves.toBe(false);
		} finally {
			await runtime.dispose();
		}
	});

	it("setConfig rejects unknown ids and treats an absent config as {}", async () => {
		const runtime = makeRuntime();
		try {
			const unknown = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setConfig("nope", {})).pipe(Effect.flip),
			);
			expect(unknown).toBeInstanceOf(UnknownPlugin);
			// `undefined` config decodes as {} → the required `title` is missing.
			const empty = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setConfig("test.main", undefined)).pipe(Effect.flip),
			);
			expect(empty).toBeInstanceOf(InvalidPluginConfig);
		} finally {
			await runtime.dispose();
		}
	});

	it("reads degrade a corrupt stored config row to schema defaults", async () => {
		const db = makeDb(makeD1(DDL));
		const runtime = ManagedRuntime.make(
			makePluginStatesLive(testPlugins).pipe(Layer.provide(Layer.succeed(Db, db))),
		);
		try {
			await db.insert(pluginState).values({
				pluginId: "test.main",
				enabled: true,
				config: "{not json",
				updatedAt: new Date(),
			});
			const config = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.config("test.main")),
			);
			expect(config).toEqual({ retries: 3, verbose: false, mode: "fast" });
		} finally {
			await runtime.dispose();
		}
	});

	it("flattens empty-path pointers in config issues", async () => {
		// A property literally named "" produces a Pointer whose joined
		// path is "" — the formatter must not emit a leading ": ".
		const weird = definePlugin({
			id: "test.weird",
			configSchema: Schema.Struct({ "": Schema.String }),
		});
		const runtime = ManagedRuntime.make(
			makePluginStatesLive([weird]).pipe(Layer.provide(Layer.succeed(Db, makeDb(makeD1(DDL))))),
		);
		try {
			const bad = await withStates(
				runtime,
				Effect.flatMap(PluginStates, (s) => s.setConfig("test.weird", { "": 1 })).pipe(Effect.flip),
			);
			expect(bad).toBeInstanceOf(InvalidPluginConfig);
			expect((bad as InvalidPluginConfig).issues.join("\n")).not.toContain(": ");
		} finally {
			await runtime.dispose();
		}
	});
});

describe("pluginConfigDefaults", () => {
	it("collects `default` keywords from the document's properties", () => {
		expect(pluginConfigDefaults(mainPlugin.meta!.config)).toEqual({
			retries: 3,
			verbose: false,
			mode: "fast",
		});
		expect(pluginConfigDefaults(undefined)).toEqual({});
	});
});

describe("validatePluginConfig", () => {
	const defaults = pluginConfigDefaults(mainPlugin.meta!.config);

	it("rejects non-object input", () => {
		expect(validatePluginConfig(mainConfigSchema, defaults, "x")).toEqual({
			ok: false,
			issues: ["config must be a JSON object"],
		});
		expect(validatePluginConfig(mainConfigSchema, defaults, null).ok).toBe(false);
		expect(validatePluginConfig(mainConfigSchema, defaults, [1]).ok).toBe(false);
	});

	it("checks each field type strictly via the effect/Schema", () => {
		expect(validatePluginConfig(mainConfigSchema, defaults, { title: 1 }).ok).toBe(false);
		expect(
			validatePluginConfig(mainConfigSchema, defaults, { title: "T", verbose: "yes" }).ok,
		).toBe(false);
		expect(validatePluginConfig(mainConfigSchema, defaults, { title: "T", mode: "warp" }).ok).toBe(
			false,
		);
		expect(
			validatePluginConfig(mainConfigSchema, defaults, { title: "T", retries: Number.NaN }).ok,
		).toBe(false);
	});

	it("requires keys the Schema does not mark optional", () => {
		const out = validatePluginConfig(mainConfigSchema, defaults, {});
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.issues.join("\n")).toContain("title");
	});

	it("fills defaults and drops unknown keys", () => {
		const out = validatePluginConfig(mainConfigSchema, defaults, { title: "T", extra: 1 });
		expect(out).toEqual({
			ok: true,
			value: { title: "T", retries: 3, verbose: false, mode: "fast" },
		});
	});

	it("treats null/undefined values as unset", () => {
		const out = validatePluginConfig(mainConfigSchema, defaults, {
			title: "T",
			verbose: null,
		});
		expect(out).toEqual({
			ok: true,
			value: { title: "T", retries: 3, verbose: false, mode: "fast" },
		});
	});

	it("keeps only defaults when the schema decodes to a non-object", () => {
		// A configSchema may transform the object into a scalar — the
		// decoded success is then not a plain object and contributes
		// nothing beyond the defaults.
		const scalar = Schema.Struct({ title: Schema.String }).pipe(
			Schema.decodeTo(Schema.String, {
				decode: SchemaGetter.transform((s) => s.title),
				encode: SchemaGetter.transform((s) => ({ title: s })),
			}),
		);
		expect(validatePluginConfig(scalar, {}, { title: "T" })).toEqual({
			ok: true,
			value: {},
		});
	});
});

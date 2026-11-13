import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { eq } from "drizzle-orm";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import { Db } from "@ktb/db";
import { pluginState } from "@ktb/db/schema";
import type { Plugin, PluginConfigSchema } from "@ktb/kernel";

/**
 * Runtime plugin state service (P-058). Provided by the composition root
 * from the discovered plugin registry — the service knows every plugin id,
 * its `requiredDeps` edges and its `meta.config` schema, so enable/config
 * writes are validated against the real dep graph and config contract.
 *
 * Semantics: no `plugin_state` row means ENABLED with schema-default
 * config (opt-out — toggling a plugin off is the exception, not the
 * rule). `config` NULL means "use meta defaults".
 *
 * System plugins (`system: true` on the manifest, P-062) are always
 * enabled: `isEnabled`/`enabledIds`/`entries` ignore `plugin_state`
 * rows for them entirely (a stale disabled row is dead data), and
 * `setEnabled(…, false)` fails with `PluginSystemLocked`. Config writes
 * stay allowed — config is not enablement.
 */

/** Dispatch/UI reached for a plugin (or whole plugin package) that is
 * disabled — fail-closed answer for CQRS gating and route helpers. */
export class PluginDisabled extends Data.TaggedError("PluginDisabled")<{
	readonly pluginId: string;
}> {}

/** The id is not part of the discovered plugin registry. */
export class UnknownPlugin extends Data.TaggedError("UnknownPlugin")<{
	readonly pluginId: string;
}> {}

/** `setConfig` input failed schema validation, or the plugin declares
 * no `meta.config` schema at all. */
export class InvalidPluginConfig extends Data.TaggedError("InvalidPluginConfig")<{
	readonly pluginId: string;
	readonly issues: readonly string[];
}> {}

/** A write would leave an enabled plugin whose `requiredDeps` are not
 * all enabled (e.g. disabling a dep without its dependents). */
export class PluginDepsUnsatisfied extends Data.TaggedError("PluginDepsUnsatisfied")<{
	readonly pluginId: string;
	readonly missingDeps: readonly string[];
}> {}

/** A `setEnabled(…, false)` write targeted a `system: true` plugin —
 * system plugins can never be disabled (P-062). */
export class PluginSystemLocked extends Data.TaggedError("PluginSystemLocked")<{
	readonly pluginId: string;
}> {}

export interface PluginStateEntry {
	readonly pluginId: string;
	readonly enabled: boolean;
	/** `system: true` on the manifest — the plugin can never be
	 * disabled; `enabled` is always true for these. */
	readonly system: boolean;
	/** Merged config: schema defaults overlaid with the stored JSON. */
	readonly config: unknown;
}

export interface PluginStatesShape {
	/** `row?.enabled ?? true` — unknown ids count as enabled. */
	readonly isEnabled: (pluginId: string) => Effect.Effect<boolean>;
	/** Every registry-known plugin id that is currently enabled. */
	readonly enabledIds: () => Effect.Effect<ReadonlySet<string>>;
	/** Defaults merged with the stored JSON for `pluginId`. */
	readonly config: (pluginId: string) => Effect.Effect<unknown, UnknownPlugin>;
	/** Upsert `enabled` for every id; the post-write dep invariant is
	 * enforced (enabled plugins must have all requiredDeps enabled). */
	readonly setEnabled: (
		ids: readonly string[],
		enabled: boolean,
	) => Effect.Effect<void, UnknownPlugin | PluginDepsUnsatisfied | PluginSystemLocked>;
	/** Schema-validated config write; missing keys fill defaults. */
	readonly setConfig: (
		pluginId: string,
		config: unknown,
	) => Effect.Effect<void, UnknownPlugin | InvalidPluginConfig>;
	/** Every registry-known plugin with its resolved state — the
	 * /platform/plugins page loader. */
	readonly entries: () => Effect.Effect<ReadonlyArray<PluginStateEntry>>;
}

export class PluginStates extends Context.Service<PluginStates, PluginStatesShape>()(
	"@ktb/platform/PluginStates",
) {}

/** Route/loader convenience: is `pluginId` enabled right now? Requires
 * `PluginStates` in the environment (core provides it). */
export const pluginEnabled = (pluginId: string): Effect.Effect<boolean, never, PluginStates> =>
	Effect.flatMap(PluginStates, (states) => states.isEnabled(pluginId));

// ---------- config schema helpers (pure — unit-tested) ----------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `default` keywords declared on the top-level properties of a plugin's
 * JSON-Schema config document (`meta.config.schema`) — the fill-in
 * values for absent config keys. Single source of truth: plugins derive
 * the document from their effect/Schema via `Schema.toJsonSchemaDocument`,
 * so `default` annotations on the Schema land here automatically.
 */
export const pluginConfigDefaults = (
	config: PluginConfigSchema | undefined,
): Record<string, unknown> => {
	const properties = config?.schema.schema.properties;
	if (!isPlainObject(properties)) return {};
	const defaults: Record<string, unknown> = {};
	for (const [key, prop] of Object.entries(properties)) {
		if (isPlainObject(prop) && "default" in prop) defaults[key] = prop.default;
	}
	return defaults;
};

const formatLeafIssue = SchemaIssue.makeFormatterDefault();

/** Flatten a SchemaIssue tree into `"path: message"` strings for
 * `InvalidPluginConfig.issues`. Composite/AnyOf nodes fan out;
 * Pointer/Filter/Encoding unwrap (accumulating the path); leaves format
 * via the standard SchemaIssue formatter. */
const formatConfigIssues = (issue: SchemaIssue.Issue, path: readonly string[] = []): string[] => {
	switch (issue._tag) {
		case "Pointer": {
			const key = issue.path.map((segment) => String(segment)).join(".");
			return formatConfigIssues(issue.issue, key === "" ? path : [...path, key]);
		}
		case "Composite":
		case "AnyOf":
			return issue.issues.flatMap((i) => formatConfigIssues(i, path));
		case "Filter":
		case "Encoding":
			return formatConfigIssues(issue.issue, path);
		default: {
			const message = formatLeafIssue(issue).trim();
			return [path.length === 0 ? message : `${path.join(".")}: ${message}`];
		}
	}
};

/**
 * Validate `input` against a plugin's config contract. `configSchema`
 * is the plugin's effect/Schema (`Plugin.configSchema`) — the runtime
 * source of truth; `defaults` comes from `pluginConfigDefaults` (the
 * JSON document's `default` keywords) and fills absent keys both before
 * decoding (so a defaulted required key passes) and after (so optional
 * keys still surface their default). `null`/`undefined` values count as
 * unset — same leniency the retired field-descriptor validator had.
 * On success returns the decoded object (unknown keys dropped by the
 * Struct decode, defaults merged); on failure the flattened issues.
 */
export const validatePluginConfig = (
	configSchema: Schema.ConstraintDecoder<unknown>,
	defaults: Readonly<Record<string, unknown>>,
	input: unknown,
):
	| { readonly ok: true; readonly value: Record<string, unknown> }
	| { readonly ok: false; readonly issues: readonly string[] } => {
	if (!isPlainObject(input)) {
		return { ok: false, issues: ["config must be a JSON object"] };
	}
	const provided = Object.fromEntries(
		Object.entries(input).filter(([, v]) => v !== undefined && v !== null),
	);
	const result = Schema.decodeUnknownResult(configSchema)({ ...defaults, ...provided });
	if (Result.isFailure(result)) {
		return { ok: false, issues: formatConfigIssues(result.failure.issue) };
	}
	return {
		ok: true,
		value: {
			...defaults,
			...(isPlainObject(result.success) ? result.success : {}),
		},
	};
};

/** Stored JSON overlaid on schema defaults — used by `config()`/`entries()`
 * reads. Lenient by design: reads never reject (a corrupt or partial
 * stored value simply merges over the defaults; writes are the strict
 * path via `validatePluginConfig`). */
const mergePluginConfig = (config: PluginConfigSchema | undefined, stored: unknown): unknown => {
	if (config === undefined) return stored ?? null;
	return { ...pluginConfigDefaults(config), ...(isPlainObject(stored) ? stored : {}) };
};

const parseStoredConfig = (raw: string | null): unknown => {
	if (raw === null) return null;
	try {
		return JSON.parse(raw);
	} catch {
		// A corrupt row degrades to "no stored config" rather than taking
		// the whole service down — the next write replaces it.
		return null;
	}
};

/**
 * Build the live layer from the discovered plugin registry. The dep
 * graph (`requiredDeps`), config documents (`meta.config`) and runtime
 * validators (`configSchema`) are captured once at composition — all
 * are compile-time manifest data, so runtime toggles never change them.
 */
export const makePluginStatesLive = (plugins: readonly Plugin[]) =>
	Layer.effect(
		PluginStates,
		Effect.gen(function* () {
			const db = yield* Db;
			const known = new Map(plugins.map((p) => [p.id, p] as const));
			// `configSchema` is the runtime validator (server-only effect/
			// Schema); `meta.config` is the serializable JSON document that
			// supplies defaults on reads. A plugin may declare either.
			const configSchemas = new Map(
				plugins.flatMap((p) =>
					p.configSchema !== undefined ? [[p.id, p.configSchema] as const] : [],
				),
			);
			const configDocs = new Map(
				plugins.flatMap((p) =>
					p.meta?.config !== undefined ? [[p.id, p.meta.config] as const] : [],
				),
			);

			const rowFor = async (pluginId: string) => {
				const rows = await db
					.select()
					.from(pluginState)
					.where(eq(pluginState.pluginId, pluginId))
					.limit(1);
				return rows[0] ?? null;
			};

			const allRows = async () => db.select().from(pluginState);

			const isEnabledRow = (row: { enabled: boolean } | null | undefined) => row?.enabled ?? true;

			/** Post-write invariant check: every ENABLED plugin's
			 * requiredDeps must also be enabled. Returns the first
			 * violation or null. */
			const depViolation = (
				enabled: ReadonlyMap<string, boolean>,
			): { pluginId: string; missingDeps: readonly string[] } | null => {
				for (const [id, plugin] of known) {
					if (enabled.get(id) !== true) continue;
					const missing = (plugin.requiredDeps ?? []).filter((dep) => enabled.get(dep) !== true);
					if (missing.length > 0) return { pluginId: id, missingDeps: missing };
				}
				return null;
			};

			return PluginStates.of({
				isEnabled: (pluginId) =>
					Effect.promise(async () => {
						// System plugins are always on — no row lookup, so a
						// stale disabled row can never turn one off.
						const plugin = known.get(pluginId);
						if (plugin !== undefined && plugin.system === true) return true;
						return isEnabledRow(await rowFor(pluginId));
					}),

				enabledIds: () =>
					Effect.promise(async () => {
						const rows = await allRows();
						const byId = new Map(rows.map((r) => [r.pluginId, r.enabled] as const));
						const enabled = new Set<string>();
						for (const [id, plugin] of known) {
							if (plugin.system === true || (byId.get(id) ?? true)) enabled.add(id);
						}
						return enabled;
					}),

				config: (pluginId) =>
					Effect.gen(function* () {
						if (!known.has(pluginId)) {
							return yield* Effect.fail(new UnknownPlugin({ pluginId }));
						}
						const row = yield* Effect.promise(() => rowFor(pluginId));
						return mergePluginConfig(
							configDocs.get(pluginId),
							parseStoredConfig(row?.config ?? null),
						);
					}),

				setEnabled: (ids, enabled) =>
					Effect.gen(function* () {
						for (const id of ids) {
							const plugin = known.get(id);
							if (plugin === undefined) {
								return yield* Effect.fail(new UnknownPlugin({ pluginId: id }));
							}
							// System plugins can never be disabled — reject the
							// write before any row is touched. Re-enabling one is
							// a harmless no-op write and stays allowed.
							if (!enabled && plugin.system === true) {
								return yield* Effect.fail(new PluginSystemLocked({ pluginId: id }));
							}
						}
						// Validate the POST-write state in memory BEFORE touching
						// the table — a rejected write must leave state unchanged
						// (the upserts below are not transactional).
						const rows = yield* Effect.promise(() => allRows());
						const byId = new Map(rows.map((r) => [r.pluginId, r.enabled] as const));
						const state = new Map<string, boolean>();
						// System plugins read as enabled here regardless of
						// stored rows, so they can never satisfy a "missing
						// dep" violation for a dependent.
						for (const [id, plugin] of known) {
							state.set(id, plugin.system === true ? true : (byId.get(id) ?? true));
						}
						for (const id of ids) state.set(id, enabled);
						const violation = depViolation(state);
						if (violation !== null) {
							return yield* Effect.fail(new PluginDepsUnsatisfied(violation));
						}
						const now = new Date();
						yield* Effect.promise(() =>
							Promise.all(
								ids.map((pluginId) =>
									db
										.insert(pluginState)
										.values({ pluginId, enabled, config: null, updatedAt: now })
										.onConflictDoUpdate({
											target: pluginState.pluginId,
											set: { enabled, updatedAt: now },
										}),
								),
							),
						);
					}),

				setConfig: (pluginId, config) =>
					Effect.gen(function* () {
						if (!known.has(pluginId)) {
							return yield* Effect.fail(new UnknownPlugin({ pluginId }));
						}
						const configSchema = configSchemas.get(pluginId);
						if (configSchema === undefined) {
							return yield* Effect.fail(
								new InvalidPluginConfig({
									pluginId,
									issues: ["plugin declares no configSchema"],
								}),
							);
						}
						const validated = validatePluginConfig(
							configSchema,
							pluginConfigDefaults(configDocs.get(pluginId)),
							config ?? {},
						);
						if (!validated.ok) {
							return yield* Effect.fail(
								new InvalidPluginConfig({ pluginId, issues: validated.issues }),
							);
						}
						const now = new Date();
						yield* Effect.promise(() =>
							db
								.insert(pluginState)
								.values({
									pluginId,
									enabled: true,
									config: JSON.stringify(validated.value),
									updatedAt: now,
								})
								.onConflictDoUpdate({
									target: pluginState.pluginId,
									set: { config: JSON.stringify(validated.value), updatedAt: now },
								}),
						);
					}),

				entries: () =>
					Effect.gen(function* () {
						const rows = yield* Effect.promise(() => allRows());
						const byId = new Map(rows.map((r) => [r.pluginId, r] as const));
						const out: PluginStateEntry[] = [];
						for (const [pluginId, plugin] of known) {
							const row = byId.get(pluginId);
							out.push({
								pluginId,
								enabled: plugin.system === true || isEnabledRow(row),
								system: plugin.system === true,
								config: mergePluginConfig(
									configDocs.get(pluginId),
									parseStoredConfig(row?.config ?? null),
								),
							});
						}
						return out;
					}),
			});
		}),
	);

import { Option, Schema } from "effect";
import type { JsonObject } from "effect/Schema";

/**
 * suite.ts — the eval suite manifest contract (P-074, DAG + inputs
 * by P-077).
 *
 * A suite manifest is PURE DATA: it pins a dataset, names the
 * registered stages/metrics/gates/capabilities/conditions the run
 * composes, declares cross-suite `inputs`, and selects an adapter
 * profile. Everything is referenced BY ID — stage implementations,
 * metric functions, gate policies, and condition evaluators are
 * registered contributions (see registry.ts/kinds.ts) or domain
 * dispatch tables, never inlined. That is what makes a manifest
 * serializable, diffable, and safe to store as a run artifact.
 *
 * COMPOSABILITY STATUS: stage/metric/gate/condition refs are
 * VALIDATED against the contribution registry (`eval list --strict`,
 * resolve.ts) and stage refs are DISPATCHED — `eval run` maps the
 * manifest's stage ids through the domain's run-stage selector and
 * executes them (the domain pack owns the run-stage selector; the
 * generic DAG scheduler lives in dag.ts). `stages` entries are
 * `StageEntry` = a bare id string OR a `StageNode` `{id, needs?,
 * optional?, when?}`; see dag.ts for the graph semantics (absent
 * `needs` = depends on every earlier entry, explicit `needs` =
 * exactly those ids, `needs: []` = a parallel branch root). String
 * entries keep the historical linear-chain meaning, so existing
 * manifests are unchanged. Metric refs are validated pointers only —
 * the pipeline emits one StageMetrics record per produced stage and
 * gates consume all of it, so metrics are not individually
 * dispatched. Gate refs dispatch through the composition root's gate
 * decoders (apps/eval policy.ts). `meta.fn` on a contribution stays a
 * human/ops pointer, not a callable key.
 *
 * CONFIG EXPRESSIVENESS (P-078): stage/metric/gate/condition entries
 * may carry a `config` JSON object (gates also accept legacy `params`,
 * normalized to `config` at resolution). The config SHAPE is owned by
 * the contribution: each contribution may declare a `validateConfig`
 * function (registry.ts `ContributionWithConfig`) that apps/eval runs
 * at `eval list`/`eval run` resolution — effect/Schema is not
 * JSON-serializable, so validation is contributor code, never
 * manifest data. Gate entries may instead name an `eval.gatepreset`
 * contribution (`{preset, overrides?}`) — a versioned bundle of gate
 * refs contributed as data (`meta.gates`, see GatePresetPayload)
 * that expands to concrete `{id, config}` invocations, with
 * `overrides` shallow-merging per gate id.
 *
 * `inputs` (P-077) declares cross-suite composition: refs to other
 * suites' persisted SampleResult artifacts (`{suite, stage?, field?,
 * runId?, datasetVersion?}`). apps/eval resolves them against the
 * shared workdir store before the run; the domain runner decides
 * which resolved fields become stage inputs (today: prior `asrText`
 * may replace the transcribe stage — see pipeline.ts
 * `priorAsrText`). Resolved inputs are lineage: the run's Experiment
 * records `derivedFrom` = the source run ids.
 *
 * This file knows nothing about any specific eval domain — domain
 * packs declare their own `domain` id and contribution ids.
 */

/** Dataset pin — id + version of the dataset the suite runs against. */
export const SuiteDataset = Schema.Struct({
	id: Schema.String,
	version: Schema.String,
});
export type SuiteDataset = typeof SuiteDataset.Type;

/** One named reference to a registered contribution with optional
 * config (P-078): `config` is a JSON object validated against the
 * contribution's own `validateConfig` at resolution time
 * (apps/eval resolve.ts) — the config SHAPE is contributor-owned,
 * eval-core stays domain-blind. Metric entries use this; stage
 * nodes carry the same field inline (StageNode.config). */
export const ContributionRef = Schema.Struct({
	id: Schema.String,
	config: Schema.optionalKey(Schema.JsonObject),
});
export type ContributionRef = typeof ContributionRef.Type;

/** The stage id + config of one metric-style ref entry. */
export const refIdOf = (entry: string | ContributionRef): string =>
	typeof entry === "string" ? entry : entry.id;

/** The declared config of a ref entry — `undefined` for bare ids. */
export const refConfigOf = (entry: string | ContributionRef): JsonObject | undefined =>
	typeof entry === "string" ? undefined : entry.config;

/** One gate invocation — EITHER a registered gate id (`id`, with
 * `config` — or legacy `params`, normalized to config at resolution)
 * OR a named gate preset (`preset`, an `eval.gatepreset` contribution
 * id whose meta.gates bundle expands to concrete gate refs, with
 * optional per-gate `overrides`). Exactly one of `id`/`preset` must
 * be set; `config`/`params` belong on `id` entries, `overrides` on
 * `preset` entries. All fields are JSON data — gate policies are
 * data, not closures. */
export const SuiteGateEntry = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	preset: Schema.optionalKey(Schema.String),
	config: Schema.optionalKey(Schema.JsonObject),
	/** @deprecated legacy alias for `config` — kept so pre-P-078
	 * manifests keep working; setting both is rejected. */
	params: Schema.optionalKey(Schema.JsonObject),
	overrides: Schema.optionalKey(Schema.Record(Schema.String, Schema.JsonObject)),
}).pipe(
	Schema.check(
		Schema.makeFilter((g) => {
			const hasId = g.id !== undefined;
			const hasPreset = g.preset !== undefined;
			if (hasId === hasPreset) {
				return "gate entry needs exactly one of `id` or `preset`";
			}
			if (hasId) {
				if (g.config !== undefined && g.params !== undefined) {
					return "gate entry cannot set both `config` and legacy `params`";
				}
				if (g.overrides !== undefined) {
					return "`overrides` is only valid on a `preset` gate entry";
				}
				return true;
			}
			if (g.config !== undefined || g.params !== undefined) {
				return "`config`/`params` belong on `id` gate entries — preset entries take `overrides`";
			}
			return true;
		}),
	),
);
export type SuiteGateEntry = typeof SuiteGateEntry.Type;

/** The effective config of an `id` gate entry — `config` wins,
 * legacy `params` is the fallback. `undefined` on preset entries
 * (their per-gate configs live in the preset payload). */
export const gateEntryConfig = (entry: SuiteGateEntry): JsonObject | undefined =>
	entry.id !== undefined ? (entry.config ?? entry.params) : undefined;

/** Declared payload of an `eval.gatepreset` contribution's `meta`
 * (P-078): a named, versioned bundle of gate refs — the same
 * `{id, config}` shape manifests use, pure JSON data. apps/eval
 * validates `meta` against this before expanding. */
export const GatePresetPayload = Schema.Struct({
	gates: Schema.Array(ContributionRef),
});
export type GatePresetPayload = typeof GatePresetPayload.Type;

/** Conditional-stage guard (P-077): `condition` is a registered
 * `eval.condition` contribution id; `params` is a JSON object —
 * condition evaluators are data-in/data-out, never closures. The
 * scheduler (dag.ts) evaluates `when` once all of the node's `needs`
 * have completed; a false result skips the node (and transitively
 * skips dependents that required its output). */
export const StageCondition = Schema.Struct({
	condition: Schema.String,
	params: Schema.optionalKey(Schema.JsonObject),
});
export type StageCondition = typeof StageCondition.Type;

/** One DAG node — a registered stage id plus optional dependency and
 * guard declarations. `needs` absent = depends on EVERY earlier
 * `stages` entry (the linear-chain default that keeps string entries
 * and pre-DAG manifests sequential); `needs` present = exactly those
 * stage ids (forward refs allowed — the topo sort resolves them);
 * `needs: []` = a parallel branch root. `optional: true` tolerates
 * the node's own failure: dependents still run (they see whatever
 * outputs exist); a failed REQUIRED node skips its dependents.
 * `when` gates execution on a registered condition contribution. */
export const StageNode = Schema.Struct({
	id: Schema.String,
	needs: Schema.optionalKey(Schema.Array(Schema.String)),
	optional: Schema.optionalKey(Schema.Boolean),
	when: Schema.optionalKey(StageCondition),
	/** Optional stage config (P-078) — validated against the stage
	 * contribution's `validateConfig` at resolution time. */
	config: Schema.optionalKey(Schema.JsonObject),
});
export type StageNode = typeof StageNode.Type;

/** A `stages` entry — bare id (linear-chain node) or a full node. */
export const StageEntry = Schema.Union([Schema.String, StageNode]);
export type StageEntry = typeof StageEntry.Type;

/** Cross-suite input ref (P-077): consume another suite's persisted
 * artifacts as this run's inputs. `suite` is a suite manifest id in
 * the same evals/ tree; `stage`+`field` select the artifact (field
 * defaults from stage — see apps/eval inputs.ts); `runId` pins an
 * exact prior run (an Experiment id), `datasetVersion` pins the
 * cohort — absent both, the source suite's own dataset pin applies
 * and the newest run wins. */
export const SuiteInput = Schema.Struct({
	suite: Schema.String,
	stage: Schema.optionalKey(Schema.String),
	field: Schema.optionalKey(Schema.String),
	runId: Schema.optionalKey(Schema.String),
	datasetVersion: Schema.optionalKey(Schema.String),
});
export type SuiteInput = typeof SuiteInput.Type;

/** Suite manifest — pure data, decoded/validated at definition time.
 * `stages[].id`, `metrics`, `gates[].id`, and `stages[].when.condition`
 * are registered contribution ids; `caps` maps capability name →
 * providing plugin id; `inputs[].suite` references another suite
 * manifest id. */
export const EvalSuiteManifest = Schema.Struct({
	id: Schema.String,
	/** Domain pack id that owns this suite's vocabulary
	 * (e.g. "eval.dom.<name>"). */
	domain: Schema.String,
	dataset: SuiteDataset,
	stages: Schema.Array(StageEntry),
	caps: Schema.Record(Schema.String, Schema.String),
	/** Metric refs — bare id string or `{id, config}` (P-078);
	 * `config` validates against the metric contribution's
	 * `validateConfig` at resolution. */
	metrics: Schema.Array(Schema.Union([Schema.String, ContributionRef])),
	/** Gate entries — `{id, config?|params?}` or `{preset, overrides?}`
	 * (P-078); presets expand to concrete gate refs at resolution. */
	gates: Schema.Array(SuiteGateEntry),
	schemaVersion: Schema.Number,
	/** Optional adapter profile selector — which adapter set resolves
	 * the suite's ports (e.g. "stub", "local", "cloud"). */
	adapterProfile: Schema.optionalKey(Schema.String),
	/** Cross-suite composition refs (P-077) — resolved by apps/eval
	 * against the shared workdir store before the run. */
	inputs: Schema.optionalKey(Schema.Array(SuiteInput)),
});
export type EvalSuiteManifest = typeof EvalSuiteManifest.Type;

/** The stage id of one `stages` entry — string passthrough or node.id. */
export const stageIdOf = (entry: StageEntry): string =>
	typeof entry === "string" ? entry : entry.id;

/** All declared stage ids in manifest order (node details stripped). */
export const stageIdsOf = (entries: readonly StageEntry[]): readonly string[] =>
	entries.map(stageIdOf);

/** Entries normalized to StageNode form — strings become `{id}`.
 * `needs` stays absent here; the graph builder (dag.ts) applies the
 * "all preceding entries" default. */
export const stageNodesOf = (entries: readonly StageEntry[]): readonly StageNode[] =>
	entries.map((e) => (typeof e === "string" ? { id: e } : e));

/** Validate + decode a manifest object. Returns `null` on any schema
 * violation — use when the input is untrusted (file, wire). */
export const validateManifest = (input: unknown): EvalSuiteManifest | null =>
	Option.getOrNull(Schema.decodeUnknownOption(EvalSuiteManifest)(input));

/** Define a suite manifest — throws a Schema parse error when `input`
 * is not pure manifest data (missing fields, non-string refs,
 * non-JSON gate/condition params, inline functions, …). */
export const defineSuite = (input: unknown): EvalSuiteManifest =>
	Schema.decodeUnknownSync(EvalSuiteManifest)(input);

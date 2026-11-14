import { Option, Schema } from "effect";

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

/** One gate invocation — the registered gate id plus its params.
 * `params` is a JSON object: gate policies are data, not closures. */
export const SuiteGate = Schema.Struct({
	id: Schema.String,
	params: Schema.optionalKey(Schema.JsonObject),
});
export type SuiteGate = typeof SuiteGate.Type;

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
	metrics: Schema.Array(Schema.String),
	gates: Schema.Array(SuiteGate),
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

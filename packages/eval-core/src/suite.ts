import { Option, Schema } from "effect";

/**
 * suite.ts — the eval suite manifest contract (P-074).
 *
 * A suite manifest is PURE DATA: it pins a dataset, names the
 * registered stages/metrics/gates/capabilities the run composes, and
 * selects an adapter profile. Everything is referenced BY ID — stage
 * implementations, metric functions, and gate policies are registered
 * contributions (see registry.ts), never inlined. That is what makes a
 * manifest serializable, diffable, and safe to store as a run artifact.
 *
 * COMPOSABILITY STATUS: stage/metric/gate refs are VALIDATED against
 * the contribution registry (`eval list --strict`, resolve.ts) and
 * stages are DISPATCHED — `eval run` maps the manifest's stage ids
 * through the domain's run-stage selector and executes them in
 * declared order (a selection may narrow the pipeline, never reorder
 * it; see plugins/eval-consult pipeline.ts RUN_STAGE_FNS). Metric
 * refs are validated pointers only — the pipeline emits one
 * StageMetrics record per produced stage and gates consume all of
 * it, so metrics are not individually dispatched. Gate refs dispatch
 * through the composition root's gate decoders (apps/eval
 * policy.ts). `meta.fn` on a contribution stays a human/ops pointer,
 * not a callable key.
 *
 * This file knows nothing about transcripts, consultations, or any
 * domain vocabulary — domain packs declare their own `domain` plugin
 * id and contribution ids.
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

/** Suite manifest — pure data, decoded/validated at definition time.
 * `stages`, `metrics`, and `gates[].id` are registered contribution
 * ids; `caps` maps capability name → providing plugin id. */
export const EvalSuiteManifest = Schema.Struct({
	id: Schema.String,
	/** Domain pack plugin id that owns this suite's vocabulary
	 * (e.g. "eval.dom.consult"). */
	domain: Schema.String,
	dataset: SuiteDataset,
	stages: Schema.Array(Schema.String),
	caps: Schema.Record(Schema.String, Schema.String),
	metrics: Schema.Array(Schema.String),
	gates: Schema.Array(SuiteGate),
	schemaVersion: Schema.Number,
	/** Optional adapter profile selector — which adapter set resolves
	 * the suite's ports (e.g. "stub", "local", "cloud"). */
	adapterProfile: Schema.optionalKey(Schema.String),
});
export type EvalSuiteManifest = typeof EvalSuiteManifest.Type;

/** Validate + decode a manifest object. Returns `null` on any schema
 * violation — use when the input is untrusted (file, wire). */
export const validateManifest = (input: unknown): EvalSuiteManifest | null =>
	Option.getOrNull(Schema.decodeUnknownOption(EvalSuiteManifest)(input));

/** Define a suite manifest — throws a Schema parse error when `input`
 * is not pure manifest data (missing fields, non-string refs,
 * non-JSON gate params, inline functions, …). */
export const defineSuite = (input: unknown): EvalSuiteManifest =>
	Schema.decodeUnknownSync(EvalSuiteManifest)(input);

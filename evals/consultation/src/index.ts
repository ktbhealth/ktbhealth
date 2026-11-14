import type { Contribution } from "@ktb/eval-core";

// Eval domain pack (P-074, moved under evals/ by P-075): the clinical
// consult eval domain — schema, metrics, the S0–S7 pipeline,
// personas/scriptgen/generate, anonymize, the ACP wire contract,
// locale profiles and the auto-accept gate. `@ktb/eval-consultation`
// is the domain's public surface; the generic framework types these
// modules build on live in @ktb/eval-core.
//
// This is NOT a plugin: domain packs live under evals/ (consumed only
// by apps/eval) and are plain workspace packages — no `plugins`
// manifest, no `definePlugin`, no `@ktb/kernel` augmentation. The
// contribution declarations below are exported as a plain array that
// the eval composition root (apps/eval/src/contributions.ts) collects
// directly.
export * from "./accept.ts";
export * from "./acp.ts";
export * from "./anonymize.ts";
export * from "./generate.ts";
export * from "./locale.ts";
export * from "./locales/pt-BR.ts";
export * from "./metrics.ts";
export * from "./negation.ts";
export * from "./personas.ts";
export * from "./phi.ts";
export * from "./pipeline.ts";
export * from "./ports.ts";
export * from "./schema.ts";
export * from "./scriptgen.ts";

/**
 * Domain metric + gate contributions (P-074 phase 4, P-070) — declared
 * as `eval.metric`/`eval.gate` entries on a plain array (the domain
 * pack is not a plugin, so there is no manifest `contributions`
 * channel; apps/eval collects this directly). The pipeline computes
 * these inline (StageMetrics carries wer/cer/entityVerdicts;
 * accept.ts owns the auto-accept policy), so `meta.fn` remains a
 * pointer for humans/ops, not a dispatch key — EXCEPT for stages:
 * suite `stages` refs really dispatch. `eval run` maps the manifest's
 * stage ids through `runStageSelection` (pipeline.ts) and executes
 * them via `RUN_STAGE_FNS` in declared order — a selection may narrow
 * the pipeline (skip judge, transcribe-only) but never reorder it
 * (canonical order transcribe → cleanup → judge). Generation stages
 * (script_gen/synthesize) are owned by `eval generate`
 * (GENERATION_STAGES).
 */
export const consultContributions: readonly Contribution[] = [
	{ kind: "eval.metric", id: "wer", version: "1", meta: { fn: "wer" } },
	{ kind: "eval.metric", id: "cer", version: "1", meta: { fn: "cer" } },
	{
		kind: "eval.metric",
		id: "entity-verdicts",
		version: "1",
		meta: { fn: "checkEntities+judge", stage: "asr|corrected" },
	},
	{
		kind: "eval.metric",
		id: "confidence-calibration",
		version: "1",
		meta: { fn: "bucketByConfidence+calibrate" },
	},
	{ kind: "eval.metric", id: "risk-score", version: "1", meta: { fn: "riskScore" } },
	{
		kind: "eval.gate",
		id: "auto-accept",
		version: "1",
		meta: { fn: "decideAutoAccept+gateRun", policy: "AcceptPolicy" },
	},
];

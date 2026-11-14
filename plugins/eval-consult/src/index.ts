import { definePlugin, type Plugin } from "@ktb/kernel";
import type { Contribution } from "@ktb/eval-core";

// Eval domain pack (P-074): the clinical consult eval domain —
// schema, metrics, the S0–S7 pipeline, personas/scriptgen/generate,
// anonymize, the ACP wire contract, locale profiles and the auto-accept
// gate. `@ktb/eval-consult` is the domain's public surface; the
// generic framework types these modules build on live in
// @ktb/eval-core.
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
 * on the manifest's `contributions` channel as `eval.metric`/
 * `eval.gate` entries. The pipeline computes these inline
 * (StageMetrics carries wer/cer/entityVerdicts; accept.ts owns the
 * auto-accept policy), so `meta.fn` remains a pointer for
 * humans/ops, not a dispatch key — EXCEPT for stages: suite `stages`
 * refs now really dispatch. `eval run` maps the manifest's stage ids
 * through `runStageSelection` (pipeline.ts) and executes them via
 * `RUN_STAGE_FNS` in declared order — a selection may narrow the
 * pipeline (skip judge, transcribe-only) but never reorder it
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

/**
 * Consult eval domain pack manifest — contributes no UI, routes,
 * services or tables; it exists so the domain code lives under the
 * plugin boundary (P-074) and carries the domain's metric/gate
 * contributions on the generic `contributions` channel (P-070). Later
 * phases can hang services/routes off `eval.consult.*` concern
 * plugins.
 */
export const evalConsultPlugin = definePlugin({
	id: "eval.consult",
	contributions: consultContributions,
});

export const plugins: readonly Plugin[] = [evalConsultPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"eval.consult": true;
	}
}

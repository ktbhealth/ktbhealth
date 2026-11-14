import { definePlugin, type Plugin } from "@ktb/kernel";
import type { Contribution } from "@ktb/eval-core";

// Eval domain pack (P-074 phase 2a): the clinical consult eval domain —
// schema, metrics, the S0–S7 pipeline, personas/scriptgen/generate,
// anonymize, the ACP wire contract, locale profiles and the auto-accept
// gate — moved out of @ktb/eval-dataset (which stays as the compat
// import path until the adapters are rewired in later phases).
// Re-exported here so `@ktb/eval-consult` is the domain's public
// surface; the generic framework types these modules build on live in
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
 * Consult eval domain pack manifest — contributes no UI, routes,
 * services or tables yet; it exists so the domain code lives under the
 * plugin boundary (P-074) and later phases can hang services/routes
 * off `eval.consult.*` concern plugins.
 */
export const evalConsultPlugin = definePlugin({
	id: "eval.consult",
});

export const plugins: readonly Plugin[] = [evalConsultPlugin];

/**
 * Domain metric + gate contributions (P-074 phase 4). The pipeline
 * computes these inline (StageMetrics carries wer/cer/entityVerdicts;
 * accept.ts owns the auto-accept policy), so `meta.fn` is a pointer
 * for humans/ops, not a dispatch key — suites reference the ids as
 * data and the composition root maps the ones it implements.
 */
export const consultContributions: readonly Contribution[] = [
	{ kind: "metric", id: "wer", version: "1", meta: { fn: "wer" } },
	{ kind: "metric", id: "cer", version: "1", meta: { fn: "cer" } },
	{
		kind: "metric",
		id: "entity-verdicts",
		version: "1",
		meta: { fn: "checkEntities+judge", stage: "asr|corrected" },
	},
	{
		kind: "metric",
		id: "confidence-calibration",
		version: "1",
		meta: { fn: "bucketByConfidence+calibrate" },
	},
	{ kind: "metric", id: "risk-score", version: "1", meta: { fn: "riskScore" } },
	{
		kind: "gate",
		id: "auto-accept",
		version: "1",
		meta: { fn: "decideAutoAccept+gateRun", policy: "AcceptPolicy" },
	},
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"eval.consult": true;
	}
}

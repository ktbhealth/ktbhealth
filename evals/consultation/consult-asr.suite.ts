import { defineSuite } from "@ktb/eval-core";

/**
 * consult-asr — the consultation ASR eval suite (P-074 phase 4).
 *
 * Pure data: pins the dataset, names the registered stage/metric/gate/
 * capability contributions the run composes, and selects the default
 * adapter profile. Stage ids are the full pipeline vocabulary —
 * script_gen/synthesize belong to dataset generation, transcribe/
 * cleanup/judge to the eval run; all five are registered stage
 * contributions from the capability plugins.
 *
 * `caps` maps capability id → providing plugin id; `adapterProfile`
 * picks the adapter set the composition root resolves per capability
 * ("stub" for CI, "local" for on-box services).
 *
 * `stages` dispatches: `eval run` executes the run-stage subset
 * (transcribe/cleanup/judge) in declared order — script_gen/
 * synthesize belong to `eval generate`. A manifest may narrow the
 * selection (e.g. drop `judge` for a transcribe-only eval) but the
 * order must respect the canonical dependency order. See
 * evals/consultation/src/pipeline.ts (RUN_STAGE_FNS) and
 * evals/README.md.
 *
 * `gates` uses the contributed `consult.standard` preset (P-078):
 * an `eval.gatepreset` bundle that expands to the auto-accept gate
 * with the AcceptPolicy params this suite always declared — same
 * gate semantics as the pre-preset `params` object, now named and
 * versioned data. `consult.strict` is the tighter variant; a
 * manifest may also write `{id: "auto-accept", config: {...}}`
 * directly or override single preset gates via `overrides`.
 *
 * Stage/metric entries may carry `config` validated by the
 * contribution's own schema (evals/consultation/src/config.ts,
 * P-078) — this suite keeps bare ids because the consultation
 * runner computes one StageMetrics record per produced stage
 * (pipeline.ts): metric `config` is validated at resolution but no
 * runner consumes it yet, so declaring it here would imply behavior
 * that does not happen. Gate `config` IS consumed — `eval gate`
 * decodes it into the AcceptPolicy.
 */
export const suite = defineSuite({
	id: "consult-asr",
	domain: "eval.consultation",
	dataset: { id: "consult-asr", version: "v1" },
	stages: ["script_gen", "synthesize", "transcribe", "cleanup", "judge"],
	caps: {
		tts: "transcription.tts",
		asr: "transcription.asr",
		llm: "llm.eval",
		eval: "llm.eval",
		store: "storage.dataset",
		report: "storage.dataset",
		registry: "storage.dataset",
	},
	metrics: ["wer", "cer", "entity-verdicts", "confidence-calibration", "risk-score"],
	gates: [{ preset: "consult.standard" }],
	schemaVersion: 1,
	adapterProfile: "stub",
});

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
 * `gates[0].params` is an AcceptPolicy (evals/consultation
 * accept.ts) — every field named so the gate is data, not code.
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
	},
	metrics: ["wer", "cer", "entity-verdicts", "confidence-calibration", "risk-score"],
	gates: [
		{
			id: "auto-accept",
			params: {
				stage: "corrected",
				maxWer: 0.05,
				target: 0.9,
				minN: 40,
				maxRisk: 0,
				maxHarmfulEdits: 0,
				maxUnjudgedEdits: 0,
			},
		},
	],
	schemaVersion: 1,
	adapterProfile: "stub",
});

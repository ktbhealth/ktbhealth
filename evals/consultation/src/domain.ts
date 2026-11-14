import { defineDomain } from "@ktb/eval-core";

import { ptBR } from "./locales/pt-BR.ts";
import { DEFAULT_MATRIX } from "./personas.ts";

/**
 * domain.ts — the consultation domain-pack DEFINITION (P-079).
 *
 * Pure data: which registered contributions assemble the eval, the
 * locale/templates/persona-matrix/PHI vocabulary, and the params a
 * suite manifest may override via `domainParams`. Zero executable
 * pipeline logic — stage impls, metric math, gate eval, anonymize
 * patterns and WER stay code (consultContributions in index.ts,
 * pipeline.ts, metrics.ts, accept.ts, anonymize.ts).
 *
 * `provides` names the contribution ids this pack's suites compose:
 * stages/capabilities are contributed by the capability plugins
 * (transcription.tts/asr, llm.eval, storage.dataset) — listed here
 * as the domain's vocabulary; metrics/gates/presets/conditions are
 * the pack's own consultContributions entries.
 *
 * `params.dataset` holds the generator defaults `eval generate`
 * reads when flags are absent; `params.voices` the default voice
 * rotation. Suite manifests override any of this via `domainParams`
 * (merged over this definition — see @ktb/eval-core domain.ts).
 */
export const domain = defineDomain({
	id: "eval.consultation",
	version: "1",
	provides: {
		stages: ["script_gen", "synthesize", "transcribe", "cleanup", "judge"],
		metrics: ["wer", "cer", "entity-verdicts", "confidence-calibration", "risk-score"],
		gates: [{ id: "auto-accept" }],
		gatePresets: ["consult.standard", "consult.strict"],
		conditions: ["wer-above"],
		capabilities: {
			tts: "transcription.tts",
			asr: "transcription.asr",
			llm: "llm.eval",
			eval: "llm.eval",
			store: "storage.dataset",
			report: "storage.dataset",
			registry: "storage.dataset",
		},
	},
	locale: { profile: ptBR.id, tag: "pt-BR" },
	templates: { dir: "templates", name: "consultation" },
	personas: DEFAULT_MATRIX,
	phi: { categories: ["cpf", "phone", "email", "date_of_birth"] },
	params: {
		dataset: { count: 8, step: 7, seed: 100, noise: "clean" },
		voices: ["br_male_1", "br_female_1"],
	},
});

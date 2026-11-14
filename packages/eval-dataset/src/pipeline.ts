import * as Effect from "effect/Effect";

import { gateTranscript } from "./anonymize.ts";
import { applyEdits, EditApplyError, type EditList } from "./diff.ts";
import type { LocaleProfile } from "./locale.ts";
import { ptBR } from "./locales/pt-BR.ts";
import {
	cer,
	checkEntities,
	normalize,
	wer,
	type ConfSegment,
	type ExpectedEntity,
} from "./metrics.ts";
import {
	AsrPort,
	DatasetStorePort,
	EvalPort,
	LlmPort,
	PortError,
	ReportPort,
	TtsPort,
} from "./ports.ts";
import type {
	AcousticProfile,
	AsrResult,
	EditVerdict,
	EntityVerdict,
	EvalQuestion,
	Persona,
	RunRecord,
	Sample,
	SampleResult,
	StageMetrics,
} from "./schema.ts";

/**
 * Pipeline stage runners (S0–S7) — pure port orchestration. Each
 * function is one stage; `processSample` chains the eval path.
 * Producing/consuming adapters never appear here.
 */

// ---------- S0: script generation (delegated via ACP envelope) ----------

export const generateScript = (input: {
	readonly taskId: string;
	readonly persona: Persona;
	readonly seed?: number;
}) =>
	Effect.gen(function* () {
		const llm = yield* LlmPort;
		return yield* llm.generate({
			taskId: input.taskId,
			role: "generator",
			input: JSON.stringify(input.persona),
			outputSchema: "ConsultationScript",
			...(input.seed !== undefined ? { seed: input.seed } : {}),
		});
	});

// ---------- S1+S2: TTS synthesis + acoustic degradation ----------

export const synthesizeAudio = (input: {
	readonly script: string;
	readonly acoustic: AcousticProfile;
}) =>
	Effect.gen(function* () {
		const tts = yield* TtsPort;
		return yield* tts.synthesize({
			script: input.script,
			voiceId: input.acoustic.voiceId,
			acoustic: input.acoustic,
		});
	});

// ---------- S3: ASR ----------

export const transcribeSample = (sample: Sample, profile: LocaleProfile = ptBR) =>
	Effect.gen(function* () {
		if (!sample.audio) {
			return yield* new PortError({
				port: "pipeline",
				message: `sample ${sample.id} has no audio to transcribe`,
			});
		}
		const asr = yield* AsrPort;
		// Provenance flows to the adapter so cloud ASR can refuse
		// real-anonymized audio — voice is PHI, only synthetic audio
		// may leave the perimeter (see AsrPort in ports.ts). The
		// language hint is locale data (`profile.asrLanguage`).
		return yield* asr.transcribe(sample.audio, {
			language: profile.asrLanguage,
			origin: sample.origin,
		});
	});

// ---------- S4: LLM cleanup → reversible edits → corrected text ----------

export const cleanupTranscript = (input: { readonly taskId: string; readonly raw: string }) =>
	Effect.gen(function* () {
		const llm = yield* LlmPort;
		const { edits, record } = yield* llm.correct({
			taskId: input.taskId,
			role: "corrector",
			input: input.raw,
			outputSchema: "EditList",
		});
		// Corrupt edit lists are an expected adapter failure (LLMs emit
		// garbage offsets) — typed failure, never a silent fiber defect.
		const corrected = yield* Effect.try({
			try: () => applyEdits(input.raw, edits.ops),
			catch: (cause) =>
				new PortError({
					port: "pipeline",
					message:
						cause instanceof EditApplyError
							? `corrupt edit list at ${cause.at}: expected "${cause.expected}", got "${cause.actual}"`
							: /* v8 ignore next -- applyEdits only throws EditApplyError */ "corrupt edit list",
					cause,
				}),
		});
		return { edits, corrected, record };
	});

// ---------- S7: eval question builders ----------

/** One Noul question per expected clinical entity per stage: "does
 * this stage's text preserve this?" — per-category precision falls
 * out of the verdict list. */
export const entityQuestions = (
	entities: readonly ExpectedEntity[],
	stage: "asr" | "corrected",
): EvalQuestion[] =>
	entities.map((e, i) => ({
		id: `entity:${stage}:${e.category}:${i}`,
		kind: "noul" as const,
		text: `Does the ${stage === "asr" ? "ASR" : "corrected"} transcript correctly preserve "${e.value}" (category: ${e.category})?`,
	}));

/** One Choice question per cleanup edit — the regression-detection
 * hook that catches hallucinated/incorrect corrections. */
export const cleanupQuestions = (edits: EditList): EvalQuestion[] =>
	edits.ops.map((op, i) => ({
		id: `edit:${i}`,
		kind: "choice" as const,
		text: `Edit at ${op.at}: removed "${op.remove}" → inserted "${op.insert}". Classify.`,
		options: ["justified_fix", "unnecessary", "harmful"],
	}));

const verdictsFromAnswers = (
	entities: readonly ExpectedEntity[],
	stage: "asr" | "corrected",
	answers: readonly { id: string; value: unknown; probability: number }[],
): EntityVerdict[] =>
	entities.map((e, i) => {
		const a = answers.find((x) => x.id === `entity:${stage}:${e.category}:${i}`);
		// Noul answers only distinguish preserved/not — "substituted" and
		// "invented" stay unreachable here until richer question kinds
		// land (see EntityStatus in schema.ts).
		const kept = a?.value === true;
		return {
			category: e.category,
			entity: e.value,
			status: kept ? ("correct" as const) : ("dropped" as const),
			source: "judge" as const,
			...(a ? { probability: a.probability } : {}),
		};
	});

const editVerdictsFromAnswers = (
	edits: EditList,
	answers: readonly { id: string; value: unknown; probability: number }[],
): EditVerdict[] =>
	edits.ops.map((_, i) => {
		const a = answers.find((x) => x.id === `edit:${i}`);
		// No answer → "unjudged". A missing verdict must never pass for
		// the most benign class — gates rely on this being explicit.
		const cls =
			a?.value === "justified_fix" || a?.value === "unnecessary" || a?.value === "harmful"
				? a.value
				: ("unjudged" as const);
		return {
			editIndex: i,
			classification: cls,
			...(a ? { probability: a.probability } : {}),
		};
	});

// ---------- the S3 → S4 → S7 sample run ----------

export interface SampleRun {
	readonly sampleId: string;
	readonly asr: AsrResult;
	readonly edits: EditList;
	readonly corrected: string;
	readonly asrMetrics: StageMetrics;
	readonly correctedMetrics: StageMetrics;
	readonly editVerdicts: readonly EditVerdict[];
	readonly confSegments: readonly ConfSegment[];
	readonly records: readonly RunRecord[];
}

/**
 * S3 → S4 → S7 over one sample: transcribe, cleanup, then judge.
 * Each stage gets its OWN judge state — scoring the ASR baseline
 * against a state that contains the corrected text contaminates the
 * measurement. Critical errors = any entity not "correct".
 * Entities default to the sample's persisted gold annotations.
 */
export const processSample = (input: {
	readonly sample: Sample;
	readonly runId?: string;
	readonly entities?: readonly ExpectedEntity[];
	/** Locale profile — normalization, PHI scrub, ASR language.
	 * Default pt-BR; `profile.id` is persisted as the metrics'
	 * normalization label. */
	readonly profile?: LocaleProfile;
}) =>
	Effect.gen(function* () {
		const profile = input.profile ?? ptBR;
		const entities = input.entities ?? input.sample.gold.entities ?? [];
		// Include datasetVersion — the same sample.id re-run under a new
		// dataset version must not collide with the old run's records.
		const runId = input.runId ?? `run-${input.sample.datasetVersion}-${input.sample.id}`;
		// PHI gate (M4): a real_anonymized script is re-scrubbed before
		// ANY stage can egress it — judge state, cleanup input via ASR
		// text, metrics. gateTranscript returns audit counts and never
		// throws; null means residual identifiers survived scrubbing —
		// fail closed before a single port call. Synthetic scripts are
		// generator output and skip the gate (scrubbing would corrupt
		// the gold text metrics compare against).
		const gated =
			input.sample.origin === "real_anonymized"
				? gateTranscript(input.sample.script, profile)
				: undefined;
		if (input.sample.origin === "real_anonymized" && gated === null) {
			return yield* new PortError({
				port: "pipeline",
				message: `sample ${input.sample.id} failed the PHI gate: residual identifiers in script`,
			});
		}
		// Downstream stages see the scrubbed text, not the stored
		// script — ingest owns persisting the clean form.
		const script = gated?.text ?? input.sample.script;
		const tag = (r: RunRecord): RunRecord => ({
			...r,
			runId,
			sampleId: input.sample.id,
			datasetVersion: input.sample.datasetVersion,
		});
		const records: RunRecord[] = [];

		const { asr, record: asrRecord } = yield* transcribeSample(input.sample, profile);
		records.push(tag(asrRecord));

		const {
			edits,
			corrected,
			record: cleanRecord,
		} = yield* cleanupTranscript({
			taskId: `${runId}-cleanup`,
			raw: asr.text,
		});
		records.push(tag(cleanRecord));

		const ev = yield* EvalPort;
		const asrQs = entityQuestions(entities, "asr");
		const correctedQs = entityQuestions(entities, "corrected");
		const editQs = cleanupQuestions(edits);

		// Scoped states — no judge sees a later stage's text.
		const answers: { id: string; kind: string; value: unknown; probability: number }[] = [];
		if (asrQs.length > 0) {
			const r = yield* ev.judge({
				state: { script, text: asr.text, persona: input.sample.persona },
				questions: asrQs,
			});
			answers.push(...r.answers);
			records.push(tag(r.record));
		}
		if (correctedQs.length > 0) {
			const r = yield* ev.judge({
				state: { script, text: corrected, persona: input.sample.persona },
				questions: correctedQs,
			});
			answers.push(...r.answers);
			records.push(tag(r.record));
		}
		if (editQs.length > 0) {
			const r = yield* ev.judge({
				state: { asrRaw: asr.text, corrected, edits: edits.ops },
				questions: editQs,
			});
			answers.push(...r.answers);
			records.push(tag(r.record));
		}

		const merge = (stage: "asr" | "corrected", text: string): readonly EntityVerdict[] => {
			const textCheck = checkEntities(entities, text, profile);
			return verdictsFromAnswers(entities, stage, answers).map((v, i) =>
				// Judge verdict wins when it produced a probability; the
				// text floor (tagged text_floor) is the fallback.
				v.probability !== undefined ? v : textCheck[i]!,
			);
		};
		const asrEntities = merge("asr", asr.text);
		const correctedEntities = merge("corrected", corrected);
		const countCritical = (vs: readonly EntityVerdict[]) =>
			vs.filter((v) => v.status !== "correct").length;

		const asrMetrics: StageMetrics = {
			wer: wer(script, asr.text, { profile }),
			cer: cer(script, asr.text, { profile }),
			criticalErrors: countCritical(asrEntities),
			entityVerdicts: asrEntities,
			stage: "asr",
			sampleId: input.sample.id,
			runId,
			normalization: profile.id,
		};
		const correctedMetrics: StageMetrics = {
			wer: wer(script, corrected, { profile }),
			cer: cer(script, corrected, { profile }),
			criticalErrors: countCritical(correctedEntities),
			entityVerdicts: correctedEntities,
			stage: "corrected",
			sampleId: input.sample.id,
			runId,
			normalization: profile.id,
		};
		// Honest floor until real segment↔gold alignment lands: a
		// segment counts correct when its normalized text appears in
		// the normalized script — never blanket-true.
		const normScript = normalize(script, { profile });
		const confSegments: ConfSegment[] = asr.segments.map((s) => ({
			...(s.confidence !== undefined ? { confidence: s.confidence } : {}),
			correct: s.text.trim().length > 0 && normScript.includes(normalize(s.text, { profile })),
		}));

		return {
			sampleId: input.sample.id,
			asr,
			edits,
			corrected,
			asrMetrics,
			correctedMetrics,
			editVerdicts: editVerdictsFromAnswers(edits, answers),
			confSegments,
			records,
		} satisfies SampleRun;
	});

/** Convert a SampleRun into its persisted SampleResult row. */
export const toSampleResult = (input: {
	readonly sample: Sample;
	readonly runId: string;
	readonly run: SampleRun;
}): SampleResult => ({
	runId: input.runId,
	sampleId: input.sample.id,
	datasetVersion: input.sample.datasetVersion,
	asrText: input.run.asr.text,
	correctedText: input.run.corrected,
	edits: input.run.edits,
	asrMetrics: input.run.asrMetrics,
	correctedMetrics: input.run.correctedMetrics,
	editVerdicts: [...input.run.editVerdicts],
	confSegments: [...input.run.confSegments],
	createdAt: Date.now(),
});

// ---------- run-record fan-out ----------

export const recordRun = (record: RunRecord) =>
	Effect.gen(function* () {
		const report = yield* ReportPort;
		yield* report.append(record);
	});

/** Persist every run-record produced by a stage chain. */
export const recordAll = (records: readonly RunRecord[]) =>
	Effect.gen(function* () {
		const report = yield* ReportPort;
		for (const r of records) yield* report.append(r);
	});

// ---------- persistence ----------

export const saveSample = (sample: Sample) =>
	Effect.gen(function* () {
		const store = yield* DatasetStorePort;
		yield* store.putSample(sample);
	});

export const saveResult = (result: SampleResult) =>
	Effect.gen(function* () {
		const store = yield* DatasetStorePort;
		yield* store.putResult(result);
	});

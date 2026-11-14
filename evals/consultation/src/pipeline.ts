import * as Effect from "effect/Effect";

import { applyEdits, EditApplyError, type EditList } from "@ktb/eval-core";

import { gateTranscript } from "./anonymize.ts";
import { fnvHex } from "./generate.ts";
import type { LocaleProfile } from "./locale.ts";
import { ptBR } from "./locales/pt-BR.ts";
import { effectiveOrigin, guardAsrPort, scrubAsrResult, untrustedOrigin } from "./phi.ts";
import {
	cer,
	checkEntities,
	normalize,
	wer,
	type ConfSegment,
	type ExpectedEntity,
} from "./metrics.ts";
import { AsrPort, DatasetStorePort, EvalPort, LlmPort, PortError, ReportPort } from "./ports.ts";
import type {
	AsrResult,
	BlobMeta,
	EditVerdict,
	EntityVerdict,
	EvalQuestion,
	RunRecord,
	Sample,
	SampleResult,
	StageMetrics,
} from "./schema.ts";

/**
 * Pipeline stage runners — pure port orchestration. The eval path
 * (S3 ASR → S4 cleanup → S7 judging) is composed by `processSample`,
 * which dispatches the manifest-selected run stages through
 * `RUN_STAGE_FNS` in declared order; the stage helpers it calls
 * (`transcribeSample`, `cleanupTranscript`, `entityQuestions`,
 * `cleanupQuestions`) stay exported for tests and for callers
 * running stages individually. Generation-side stages (S0 script,
 * S1+S2 TTS) live in generate.ts/scriptgen.ts — the
 * `generateScript`/`synthesizeAudio` wrappers that used to sit here
 * had no callers and were removed. Producing/consuming adapters
 * never appear here.
 */

// ---------- S3: ASR ----------

export const transcribeSample = (
	sample: Sample,
	profile: LocaleProfile = ptBR,
	/** Pre-resolved blob provenance — processSample already looked it
	 * up for its own scrub decision, so it hands the same record over
	 * instead of paying a second store read. `undefined` = not yet
	 * resolved (fetch it here). */
	provenance?: { readonly blobMeta: BlobMeta | null },
	/** Invoked with the ASR RunRecord the moment `transcribe` returns —
	 * BEFORE the PHI scrub gate — so a gate refusal still leaves the
	 * completed call's audit record behind. */
	onRecord?: (record: RunRecord) => void,
) =>
	Effect.gen(function* () {
		if (!sample.audio) {
			return yield* new PortError({
				port: "pipeline",
				message: `sample ${sample.id} has no audio to transcribe`,
			});
		}
		// Provenance travels WITH the audio: the blob's stored origin
		// is looked up and handed to the adapter next to the manifest's
		// declared origin, so cloud ASR can refuse real-anonymized or
		// unverified (`unknown`) audio even when the sample row says
		// "synthetic" — voice is PHI, only verified-synthetic audio may
		// leave the perimeter (see AsrPort in ports.ts). A failed
		// lookup fails closed: unverified provenance never reaches a
		// provider. The language hint is locale data (`profile.asrLanguage`).
		const blobMeta =
			provenance !== undefined
				? provenance.blobMeta
				: yield* (yield* DatasetStorePort).getBlobMeta(sample.audio.uri);
		// Structural PHI policy (phi.ts): guardAsrPort refuses
		// non-verified-synthetic audio BEFORE it reaches any
		// egress-capable adapter — enforcement no longer depends on
		// each adapter opting in (M2). Local-only ports (egress:
		// false) are unaffected.
		const asr = guardAsrPort(yield* AsrPort);
		const { asr: rawAsr, record } = yield* asr.transcribe(sample.audio, {
			language: profile.asrLanguage,
			origin: sample.origin,
			blobMeta,
		});
		onRecord?.(record);
		// ASR text is patient speech — for untrusted origins it is
		// PHI until scrubbed. Gate it HERE so every downstream consumer
		// (cleanup input, judge state, metrics, SampleResult) sees only
		// the de-identified form (H1/H2). The decision uses the EFFECTIVE
		// origin (declared ∪ stored blobMeta), not the declared hint
		// alone: a sample claiming "synthetic" whose blob is recorded
		// real_anonymized/unknown gets its ASR text scrubbed exactly
		// like a declared-untrusted sample. Synthetic-by-both-channels
		// skips the gate: scrubbing would corrupt the gold text metrics
		// compare against.
		if (!untrustedOrigin(effectiveOrigin(sample.origin, blobMeta?.origin))) {
			return { asr: rawAsr, record };
		}
		const scrubbed = scrubAsrResult(rawAsr, profile);
		if (scrubbed === null) {
			return yield* new PortError({
				port: "pipeline",
				message: `sample ${sample.id} failed the PHI gate: residual identifiers in ASR output`,
			});
		}
		return { asr: scrubbed, record };
	});

// ---------- S4: LLM cleanup → reversible edits → corrected text ----------

export const cleanupTranscript = (input: {
	readonly taskId: string;
	readonly raw: string;
	/** Invoked with the corrector's RunRecord the moment `correct`
	 * returns — BEFORE edit application — so a corrupt-edit-list
	 * failure still leaves the completed call's audit record. */
	readonly onRecord?: (record: RunRecord) => void;
}) =>
	Effect.gen(function* () {
		const llm = yield* LlmPort;
		const { edits, record } = yield* llm.correct({
			taskId: input.taskId,
			role: "corrector",
			input: input.raw,
			outputSchema: "EditList",
		});
		input.onRecord?.(record);
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

// ---------- run-stage dispatch ----------

/** Stage ids `eval run` can dispatch — the run-side subset of the
 * manifest `stages` vocabulary. Generation stages (script_gen,
 * synthesize) belong to `eval generate`; see GENERATION_STAGES. */
export const RUN_STAGES = ["transcribe", "cleanup", "judge"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export const isRunStage = (id: string): id is RunStage =>
	(RUN_STAGES as readonly string[]).includes(id);

/** Stage ids owned by dataset generation (`eval generate`) — never
 * dispatched by the eval run. */
export const GENERATION_STAGES = ["script_gen", "synthesize"] as const;

/** Canonical dependency order — each run stage consumes earlier
 * stages' outputs (cleanup reads the ASR text, judge reads both).
 * A manifest selection must be a SUBSEQUENCE of this order: it may
 * narrow the pipeline, never reorder it. */
const RUN_STAGE_ORDER: Readonly<Record<RunStage, number>> = {
	transcribe: 0,
	cleanup: 1,
	judge: 2,
};

/** Validate a run-stage selection (order as given). Returns an error
 * message, or null when runnable: every id must be a known run
 * stage, listed once, in canonical dependency order, and — unless
 * `opts.requireTranscribe` is false (a cross-suite input supplies
 * prior ASR text; see processSample `priorAsrText`) — a non-empty
 * selection must include "transcribe", which every other stage
 * consumes. */
export const runStageError = (
	stages: readonly string[],
	opts?: { readonly requireTranscribe?: boolean },
): string | null => {
	if (stages.length === 0) return "no run stages selected";
	const seen = new Set<string>();
	let prev = -1;
	for (const s of stages) {
		if (!isRunStage(s)) return `unknown run stage "${s}"`;
		if (seen.has(s)) return `stage "${s}" is listed twice`;
		seen.add(s);
		const order = RUN_STAGE_ORDER[s];
		if (order <= prev) {
			return `stage "${s}" is out of order — run stages execute ${RUN_STAGES.join(" → ")}`;
		}
		prev = order;
	}
	if (opts?.requireTranscribe !== false && !stages.includes("transcribe")) {
		return 'run stages require "transcribe" — every other stage consumes its output';
	}
	return null;
};

/** Manifest stage ids → the validated run-stage subset, in declared
 * order. Non-run ids (generation stages, foreign refs) are filtered
 * out — the caller decides whether skipping them is legitimate.
 * Throws Error with runStageError's message on an inconsistent
 * selection. `opts.requireTranscribe === false` permits a
 * transcribe-less selection (prior ASR text supplied via inputs). */
export const runStageSelection = (
	stageIds: readonly string[],
	opts?: { readonly requireTranscribe?: boolean },
): readonly RunStage[] => {
	const picked = stageIds.filter(isRunStage);
	const err = runStageError(picked, opts);
	if (err !== null) throw new Error(`invalid run stage selection: ${err}`);
	return picked;
};

// ---------- the S3 → S4 → S7 sample run ----------

export interface SampleRun {
	readonly sampleId: string;
	/** The script text every stage actually saw — the GATED (scrubbed)
	 * form for real_anonymized/unknown samples, the stored script for
	 * synthetic. Persist via `sampleForPersistence`, never the raw
	 * ingest script (H2). */
	readonly script: string;
	/** ASR output — always present: any runnable selection includes
	 * "transcribe" (see runStageError). */
	readonly asr: AsrResult;
	/** Cleanup outputs — present iff the "cleanup" stage ran. */
	readonly edits?: EditList;
	readonly corrected?: string;
	readonly asrMetrics: StageMetrics;
	/** Present iff "cleanup" ran — WER/CER/verdicts for the corrected
	 * text. Absent means the run stopped before cleanup; consumers
	 * must treat it as "no corrected-stage evidence", not a zero. */
	readonly correctedMetrics?: StageMetrics;
	/** One verdict per cleanup edit — "unjudged" for every edit when
	 * the "judge" stage did not run (never silently benign). */
	readonly editVerdicts: readonly EditVerdict[];
	readonly confSegments: readonly ConfSegment[];
	readonly records: readonly RunRecord[];
}

/** Mutable per-sample state the dispatched stage functions share —
 * each stage reads what earlier stages produced and writes its own
 * outputs back. */
interface StageRun {
	readonly sample: Sample;
	readonly profile: LocaleProfile;
	readonly entities: readonly ExpectedEntity[];
	readonly runId: string;
	/** The gated script every stage sees (see processSample). */
	readonly script: string;
	readonly tag: (r: RunRecord) => RunRecord;
	readonly records: RunRecord[];
	readonly provenance: { readonly blobMeta: BlobMeta | null } | undefined;
	asr?: AsrResult;
	edits?: EditList;
	corrected?: string;
	readonly answers: {
		readonly id: string;
		readonly kind: string;
		readonly value: unknown;
		readonly probability: number;
	}[];
}

const stageTranscribe = (ctx: StageRun) =>
	Effect.gen(function* () {
		const { asr } = yield* transcribeSample(ctx.sample, ctx.profile, ctx.provenance, (r) =>
			ctx.records.push(ctx.tag(r)),
		);
		ctx.asr = asr;
	});

const stageCleanup = (ctx: StageRun) =>
	Effect.gen(function* () {
		if (ctx.asr === undefined) {
			return yield* new PortError({
				port: "pipeline",
				message: 'stage "cleanup" requires "transcribe" to run first',
			});
		}
		const { edits, corrected } = yield* cleanupTranscript({
			taskId: `${ctx.runId}-cleanup`,
			raw: ctx.asr.text,
			onRecord: (r) => ctx.records.push(ctx.tag(r)),
		});
		ctx.edits = edits;
		ctx.corrected = corrected;
	});

const stageJudge = (ctx: StageRun) =>
	Effect.gen(function* () {
		if (ctx.asr === undefined) {
			return yield* new PortError({
				port: "pipeline",
				message: 'stage "judge" requires "transcribe" to run first',
			});
		}
		const asr = ctx.asr;
		const corrected = ctx.corrected;
		const edits = ctx.edits;
		const ev = yield* EvalPort;
		const asrQs = entityQuestions(ctx.entities, "asr");
		const correctedQs = corrected === undefined ? [] : entityQuestions(ctx.entities, "corrected");
		const editQs = edits === undefined ? [] : cleanupQuestions(edits);

		// Scoped states — no judge sees a later stage's text. A stage
		// output that does not exist yet (cleanup skipped or not yet
		// run) simply gets no questions — its verdicts fall back to
		// the text floor / "unjudged" at assembly.
		if (asrQs.length > 0) {
			const r = yield* ev.judge({
				state: { script: ctx.script, text: asr.text, persona: ctx.sample.persona },
				questions: asrQs,
			});
			ctx.answers.push(...r.answers);
			ctx.records.push(ctx.tag(r.record));
		}
		if (corrected !== undefined && correctedQs.length > 0) {
			const r = yield* ev.judge({
				state: { script: ctx.script, text: corrected, persona: ctx.sample.persona },
				questions: correctedQs,
			});
			ctx.answers.push(...r.answers);
			ctx.records.push(ctx.tag(r.record));
		}
		if (edits !== undefined && editQs.length > 0) {
			const r = yield* ev.judge({
				state: { asrRaw: asr.text, corrected, edits: edits.ops },
				questions: editQs,
			});
			ctx.answers.push(...r.answers);
			ctx.records.push(ctx.tag(r.record));
		}
	});

/** Stage id → runner — the dispatch seam suite manifests select
 * through. Order is the caller's (validated) selection order; each
 * runner reads prior stages' outputs off the shared StageRun. */
export const RUN_STAGE_FNS: Readonly<
	Record<
		RunStage,
		(
			ctx: StageRun,
		) => Effect.Effect<void, PortError, AsrPort | LlmPort | EvalPort | DatasetStorePort>
	>
> = {
	transcribe: stageTranscribe,
	cleanup: stageCleanup,
	judge: stageJudge,
};

/**
 * The manifest-selected run stages over one sample: transcribe,
 * cleanup, judge — in the order `input.stages` declares (validated
 * by runStageError; default = all three in canonical order). Skipped
 * stages produce honest absences, never fabricated outputs: no
 * cleanup → no corrected text/metrics; no judge → entity verdicts
 * come from the text floor only and every edit verdict is "unjudged".
 * Each stage gets its OWN judge state — scoring the ASR baseline
 * against a state that contains the corrected text contaminates the
 * measurement. Critical errors = any entity not "correct".
 * Entities default to the sample's persisted gold annotations.
 */
export const processSample = (input: {
	readonly sample: Sample;
	readonly runId?: string;
	readonly entities?: readonly ExpectedEntity[];
	/** Run-stage selection — ids from RUN_STAGES in executable order
	 * (see runStageError). Absent = the full pipeline. A selection
	 * WITHOUT "transcribe" is only valid when `priorAsrText` supplies
	 * the ASR output (cross-suite composition, P-077). */
	readonly stages?: readonly RunStage[];
	/** Prior-run ASR text consumed IN PLACE OF the transcribe stage
	 * (P-077 cross-suite inputs): valid only when `stages` omits
	 * "transcribe" — selecting both is a typed error, never a silent
	 * pick. The text is treated exactly like fresh ASR output:
	 * cleanup/judge/metrics consume it, and for untrusted samples it
	 * passes the same PHI gate as the stored script (it was already
	 * scrubbed when originally produced; re-gating is defense in
	 * depth). No transcribe RunRecord is emitted — no call happened;
	 * `confSegments` is empty because prior text carries no
	 * per-segment confidence. */
	readonly priorAsrText?: string;
	/** Locale profile — normalization, PHI scrub, ASR language.
	 * Default pt-BR; `profile.id` is persisted as the metrics'
	 * normalization label. */
	readonly profile?: LocaleProfile;
	/** Optional caller-owned collector — every tagged RunRecord is
	 * pushed here AS PRODUCED, so a mid-pipeline failure still exposes
	 * the partial audit trail (the run command appends whatever
	 * exists before marking the sample failed). Absent = records
	 * surface only on success via `SampleRun.records`. The same array
	 * is returned as `SampleRun.records` on success — do not also
	 * persist it twice. */
	readonly recordsOut?: RunRecord[];
}) =>
	Effect.gen(function* () {
		const profile = input.profile ?? ptBR;
		const entities = input.entities ?? input.sample.gold.entities ?? [];
		// Include datasetVersion — the same sample.id re-run under a new
		// dataset version must not collide with the old run's records.
		const runId = input.runId ?? `run-${input.sample.datasetVersion}-${input.sample.id}`;
		// Resolve provenance ONCE — declared origin merged with the
		// blob's stored blobMeta (the verified channel) — and use the
		// EFFECTIVE verdict for every text-scrub decision below. A
		// sample declaring "synthetic" whose stored blob is
		// real_anonymized/unknown is untrusted: its script is gated
		// before ANY stage can egress it (judge state, cleanup input
		// via ASR text, metrics, persistence) and its ASR text is
		// scrubbed in transcribeSample — same rule the audio guard
		// applies to egress. A failed lookup fails closed (the error
		// propagates before any port call). Samples with no audio have
		// no blob to verify — declared origin only.
		const provenance =
			input.sample.audio === undefined
				? undefined
				: {
						blobMeta: yield* (yield* DatasetStorePort).getBlobMeta(input.sample.audio.uri),
					};
		const effective = effectiveOrigin(input.sample.origin, provenance?.blobMeta?.origin);
		const untrusted = untrustedOrigin(effective);
		// PHI gate (M4 + H2): untrusted samples (real_anonymized OR
		// unknown provenance — declared OR stored) have their script
		// re-scrubbed before ANY stage can egress it — judge state,
		// cleanup input via ASR text, metrics, persistence.
		// gateTranscript returns audit counts and never throws; null
		// means residual identifiers survived scrubbing — fail closed
		// before a single port call. Synthetic-effective scripts skip
		// the gate (scrubbing would corrupt the gold text metrics
		// compare against).
		const gated = untrusted ? gateTranscript(input.sample.script, profile) : undefined;
		if (untrusted && gated === null) {
			return yield* new PortError({
				port: "pipeline",
				message: `sample ${input.sample.id} failed the PHI gate: residual identifiers in script`,
			});
		}
		// Downstream stages see the scrubbed text, not the stored
		// script. WER/CER compare THIS text against the scrubbed ASR
		// output — [TOKEN] redactions are stripped by normalize
		// (metrics.ts) so they never count as word errors; the
		// clinical content around them still scores normally. That is
		// the honest trade-off: real-sample metrics measure the
		// de-identified transcript, not the raw consult.
		const script = gated?.text ?? input.sample.script;

		// Cross-suite prior ASR text (P-077 inputs): consumed in place
		// of the transcribe stage. Re-gate it for untrusted samples
		// exactly like the script — the text was already scrubbed when
		// originally produced, so this is defense in depth, and a
		// null gate fails closed before any port call.
		let priorAsr: string | undefined;
		if (input.priorAsrText !== undefined) {
			if (untrusted) {
				const g = gateTranscript(input.priorAsrText, profile);
				if (g === null) {
					return yield* new PortError({
						port: "pipeline",
						message: `sample ${input.sample.id} failed the PHI gate: residual identifiers in prior ASR text`,
					});
				}
				priorAsr = g.text;
			} else {
				priorAsr = input.priorAsrText;
			}
		}

		const tag = (r: RunRecord): RunRecord => ({
			...r,
			runId,
			sampleId: input.sample.id,
			datasetVersion: input.sample.datasetVersion,
		});
		const records: RunRecord[] = input.recordsOut ?? [];

		// Stage selection — validated BEFORE any port call so a bad
		// manifest fails the sample honestly instead of half-running.
		// priorAsrText and a live "transcribe" are mutually exclusive;
		// prior text relaxes the must-include-transcribe rule.
		const stages = input.stages ?? RUN_STAGES;
		if (priorAsr !== undefined && stages.includes("transcribe")) {
			return yield* new PortError({
				port: "pipeline",
				message: `sample ${input.sample.id}: priorAsrText supplied but "transcribe" is selected — pick one`,
			});
		}
		const selectionError = runStageError(stages, {
			requireTranscribe: priorAsr === undefined,
		});
		if (selectionError !== null) {
			return yield* new PortError({
				port: "pipeline",
				message: `sample ${input.sample.id}: invalid stage selection — ${selectionError}`,
			});
		}

		// Dispatch in the manifest's declared order. Stage records are
		// collected THROUGH the helpers' onRecord hooks — fired the
		// moment each port call returns, before any subsequent
		// fallible step (PHI scrub gate, edit application) — so even
		// those mid-stage refusals leave their audit record.
		const ctx: StageRun = {
			sample: input.sample,
			profile,
			entities,
			runId,
			script,
			tag,
			records,
			provenance,
			answers: [],
		};
		// Seed the ASR slot from a prior run's output — downstream
		// stages cannot tell the difference (by design: the composed
		// suite consumes the artifact AS the transcribe product). No
		// RunRecord is emitted: no ASR call happened.
		if (priorAsr !== undefined) {
			ctx.asr = { text: priorAsr, segments: [] };
		}
		for (const stage of stages) {
			yield* RUN_STAGE_FNS[stage](ctx);
		}

		// "transcribe" ran live OR priorAsrText seeded the slot —
		// validation above guarantees one of the two.
		const asr = ctx.asr!;
		const answers = ctx.answers;
		const merge = (stage: "asr" | "corrected", text: string): readonly EntityVerdict[] => {
			const textCheck = checkEntities(entities, text, profile);
			return verdictsFromAnswers(entities, stage, answers).map((v, i) =>
				// Judge verdict wins when it produced a probability; the
				// text floor (tagged text_floor) is the fallback — also
				// the ONLY source when the "judge" stage was not selected.
				v.probability !== undefined ? v : textCheck[i]!,
			);
		};
		const asrEntities = merge("asr", asr.text);
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
		// Corrected-stage metrics exist only when cleanup ran — the
		// metrics array in a manifest selects WHICH contributions are
		// referenced, not which numbers get computed: wer/cer/entity
		// verdicts are one StageMetrics record per produced stage, and
		// gates consume the whole record (see evals/README.md).
		const correctedMetrics = ((): StageMetrics | undefined => {
			const text = ctx.corrected;
			if (text === undefined) return undefined;
			const verdicts = merge("corrected", text);
			return {
				wer: wer(script, text, { profile }),
				cer: cer(script, text, { profile }),
				criticalErrors: countCritical(verdicts),
				entityVerdicts: verdicts,
				stage: "corrected",
				sampleId: input.sample.id,
				runId,
				normalization: profile.id,
			};
		})();
		// Honest floor for segment correctness: a
		// segment counts correct when its normalized text appears in
		// the normalized script — never blanket-true.
		const normScript = normalize(script, { profile });
		const confSegments: ConfSegment[] = asr.segments.map((s) => ({
			...(s.confidence !== undefined ? { confidence: s.confidence } : {}),
			correct: s.text.trim().length > 0 && normScript.includes(normalize(s.text, { profile })),
		}));

		return {
			sampleId: input.sample.id,
			script,
			asr,
			...(ctx.edits !== undefined ? { edits: ctx.edits } : {}),
			...(ctx.corrected !== undefined ? { corrected: ctx.corrected } : {}),
			asrMetrics,
			...(correctedMetrics !== undefined ? { correctedMetrics } : {}),
			editVerdicts: ctx.edits === undefined ? [] : editVerdictsFromAnswers(ctx.edits, answers),
			confSegments,
			records,
		} satisfies SampleRun;
	});

/**
 * The Sample row to persist after a run (H2). For untrusted origins
 * the stored `script` MUST be the scrubbed text every stage saw —
 * `run.script` — never the raw ingest script; `scriptHash` is
 * recomputed so it stays consistent with the stored text. Synthetic
 * samples are returned unchanged (run.script === sample.script).
 */
export const sampleForPersistence = (sample: Sample, run: SampleRun): Sample =>
	run.script === sample.script
		? sample
		: { ...sample, script: run.script, scriptHash: fnvHex(run.script) };

/** Convert a SampleRun into its persisted SampleResult row.
 * asrText/correctedText/edits are already the scrubbed forms for
 * untrusted origins — transcribeSample gated the ASR text before
 * cleanup and judging, so edit ops can only span de-identified text. */
export const toSampleResult = (input: {
	readonly sample: Sample;
	readonly runId: string;
	readonly run: SampleRun;
}): SampleResult => ({
	runId: input.runId,
	sampleId: input.sample.id,
	datasetVersion: input.sample.datasetVersion,
	asrText: input.run.asr.text,
	// Absent stages persist as absent fields — SampleResult's
	// correctedText/edits/correctedMetrics are optionalKey for exactly
	// this (a transcribe-only or judge-less run is partial evidence,
	// not a zeroed corrected stage).
	...(input.run.corrected !== undefined ? { correctedText: input.run.corrected } : {}),
	...(input.run.edits !== undefined ? { edits: input.run.edits } : {}),
	asrMetrics: input.run.asrMetrics,
	...(input.run.correctedMetrics !== undefined
		? { correctedMetrics: input.run.correctedMetrics }
		: {}),
	editVerdicts: [...input.run.editVerdicts],
	confSegments: [...input.run.confSegments],
	createdAt: Date.now(),
});

// ---------- run-record fan-out ----------

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

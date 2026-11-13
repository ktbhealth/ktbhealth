import { Schema } from "effect";

/**
 * Eval-dataset schema — the manifest row every pipeline stage hangs
 * off, plus the typed verdicts the eval port returns.
 *
 * Hybrid-ready: the same row serves synthetic samples (origin
 * "synthetic", gold stamped by the generator) and phase-2 real
 * anonymized consults (origin "real_anonymized", gold validated by a
 * physician). No provider names live here — engines/models arrive as
 * opaque strings from adapters.
 */

/** Clinical categories the eval audits — critical errors are counted
 * separately from lexical WER/CER. */
export const ClinicalCategory = Schema.Literals([
	"negation",
	"medication",
	"dosage",
	"frequency",
	"unit",
	"date",
]);
export type ClinicalCategory = typeof ClinicalCategory.Type;

export const NoiseProfile = Schema.Literals(["clean", "clinic", "phone_bandpass", "far_mic"]);
export type NoiseProfile = typeof NoiseProfile.Type;

export const SampleOrigin = Schema.Literals(["synthetic", "real_anonymized"]);
export type SampleOrigin = typeof SampleOrigin.Type;

/** Persona matrix cell — one axis value per dimension. Register encodes
 * education/social class as a speech-register label (formal→colloquial). */
export const Persona = Schema.Struct({
	region: Schema.String,
	ageBand: Schema.String,
	register: Schema.String,
	specialty: Schema.String,
	gender: Schema.optionalKey(Schema.String),
	cues: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type Persona = typeof Persona.Type;

/** How a synthetic sample's audio was (or should be) rendered —
 * model, voice, degradation. Runtime accepts any engine/voice id. */
export const AcousticProfile = Schema.Struct({
	ttsModel: Schema.String,
	voiceId: Schema.String,
	noise: NoiseProfile,
	sampleRate: Schema.Number,
	prosody: Schema.optionalKey(Schema.String),
});
export type AcousticProfile = typeof AcousticProfile.Type;

/** Opaque pointer to a stored blob — adapters own the scheme
 * (file://, r2://, stub://). */
export const AudioRef = Schema.Struct({
	uri: Schema.String,
	size: Schema.optionalKey(Schema.Number),
	contentType: Schema.optionalKey(Schema.String),
});
export type AudioRef = typeof AudioRef.Type;

/** One pipeline-stage artifact: the produced text plus provenance and
 * a pointer to the auditable diff against the previous stage. */
export const StageArtifact = Schema.Struct({
	text: Schema.String,
	engine: Schema.String,
	runId: Schema.optionalKey(Schema.String),
	diffRef: Schema.optionalKey(Schema.String),
});
export type StageArtifact = typeof StageArtifact.Type;

export const SampleStages = Schema.Struct({
	asrRaw: Schema.optionalKey(StageArtifact),
	corrected: Schema.optionalKey(StageArtifact),
	approved: Schema.optionalKey(StageArtifact),
	anamnesis: Schema.optionalKey(StageArtifact),
});
export type SampleStages = typeof SampleStages.Type;

/** Phase-2 gate: real consults cannot enter the dataset without these. */
export const Provenance = Schema.Struct({
	sourcePartner: Schema.optionalKey(Schema.String),
	anonymizationMethod: Schema.optionalKey(Schema.String),
	lgpdBasis: Schema.optionalKey(Schema.String),
	consentRef: Schema.optionalKey(Schema.String),
});
export type Provenance = typeof Provenance.Type;

/** An expected clinical entity on the gold transcript — what the
 * eval must find preserved at each stage. */
export const GoldEntity = Schema.Struct({
	category: ClinicalCategory,
	value: Schema.String,
});
export type GoldEntity = typeof GoldEntity.Type;

export const Gold = Schema.Struct({
	/** "generator" for synthetic; "physician:<id>" for real samples. */
	validatedBy: Schema.String,
	validatedAt: Schema.optionalKey(Schema.Number),
	/** Physician/generator-annotated entities — persisted so phase-2
	 * annotation is part of the manifest, not a call-site argument. */
	entities: Schema.optionalKey(Schema.Array(GoldEntity)),
});
export type Gold = typeof Gold.Type;

/** Manifest row — one eval sample. LGPD gate is a Schema.filter so
 * every adapter boundary that decodes enforces it for free. */
export const Sample = Schema.Struct({
	id: Schema.String,
	datasetVersion: Schema.String,
	origin: SampleOrigin,
	script: Schema.String,
	scriptHash: Schema.String,
	persona: Persona,
	acoustic: Schema.optionalKey(AcousticProfile),
	audio: Schema.optionalKey(AudioRef),
	gold: Gold,
	provenance: Schema.optionalKey(Provenance),
	stages: Schema.optionalKey(SampleStages),
	/** Batch-runner bookkeeping: failed samples can be skipped or
	 * resumed without a re-run of the whole dataset. */
	status: Schema.optionalKey(Schema.Literals(["pending", "processed", "failed", "approved"])),
	error: Schema.optionalKey(Schema.String),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(s) =>
				s.origin !== "real_anonymized" ||
				(s.provenance?.consentRef !== undefined &&
					s.provenance?.anonymizationMethod !== undefined &&
					s.provenance?.sourcePartner !== undefined) ||
				"real_anonymized samples require provenance: sourcePartner, anonymizationMethod, consentRef",
		),
	),
);
export type Sample = typeof Sample.Type;

/** Traceability record appended per pipeline step — ACP session,
 * ASR call, judge request alike. Reproducibility = these fields. */
export const RunRecord = Schema.Struct({
	runId: Schema.String,
	taskId: Schema.String,
	stage: Schema.String,
	engine: Schema.String,
	model: Schema.optionalKey(Schema.String),
	inputHash: Schema.String,
	seed: Schema.optionalKey(Schema.Number),
	estCostUsd: Schema.optionalKey(Schema.Number),
	latencyMs: Schema.optionalKey(Schema.Number),
	startedAt: Schema.Number,
	/** Attribution + reproducibility — the fields that make a run
	 * record an audit artifact rather than a log line. */
	sampleId: Schema.optionalKey(Schema.String),
	datasetVersion: Schema.optionalKey(Schema.String),
	gitSha: Schema.optionalKey(Schema.String),
	tokens: Schema.optionalKey(Schema.Number),
	/** Pointer at the produced artifact (blob uri, diff ref, …). */
	outputRef: Schema.optionalKey(Schema.String),
});
export type RunRecord = typeof RunRecord.Type;

// ---------- ASR output ----------

export const AsrSegment = Schema.Struct({
	t0: Schema.Number,
	t1: Schema.Number,
	text: Schema.String,
	confidence: Schema.optionalKey(Schema.Number),
	/** Speaker label when the ASR provides diarization — lets the
	 * eval measure attribution and normalize label policy. */
	speaker: Schema.optionalKey(Schema.String),
});
export type AsrSegment = typeof AsrSegment.Type;

export const AsrResult = Schema.Struct({
	text: Schema.String,
	segments: Schema.Array(AsrSegment),
	language: Schema.optionalKey(Schema.String),
});
export type AsrResult = typeof AsrResult.Type;

// ---------- typed eval (decision-model) contract ----------

/** Typed question: noul = yes/no + probability, choice = one of
 * `options`, score = 0..`maxScore`. */
export const EvalQuestion = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literals(["noul", "choice", "score"]),
	text: Schema.String,
	options: Schema.optionalKey(Schema.Array(Schema.String)),
	maxScore: Schema.optionalKey(Schema.Number),
});
export type EvalQuestion = typeof EvalQuestion.Type;

export const EvalAnswer = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literals(["noul", "choice", "score"]),
	value: Schema.Union([Schema.Boolean, Schema.String, Schema.Number]),
	/** Calibrated probability reported by the decision model. */
	probability: Schema.Number,
});
export type EvalAnswer = typeof EvalAnswer.Type;

// ---------- derived verdicts ----------

export const EntityStatus = Schema.Literals([
	"correct",
	"substituted",
	"dropped",
	"invented",
	/** Present but polarity/meaning not confirmed — the text floor
	 * uses this for negations it cannot verify. */
	"unverified",
]);
export type EntityStatus = typeof EntityStatus.Type;

export const EntityVerdict = Schema.Struct({
	category: ClinicalCategory,
	entity: Schema.String,
	status: EntityStatus,
	probability: Schema.optionalKey(Schema.Number),
	/** Which engine produced the verdict — reports must never blend
	 * the substring floor with judge answers. */
	source: Schema.optionalKey(Schema.Literals(["text_floor", "judge"])),
});
export type EntityVerdict = typeof EntityVerdict.Type;

export const EditClass = Schema.Literals([
	"justified_fix",
	"unnecessary",
	"harmful",
	/** No judge answer for this edit — never silently benign. */
	"unjudged",
]);
export type EditClass = typeof EditClass.Type;

export const EditVerdict = Schema.Struct({
	editIndex: Schema.Number,
	classification: EditClass,
	severity: Schema.optionalKey(Schema.Number),
	probability: Schema.optionalKey(Schema.Number),
});
export type EditVerdict = typeof EditVerdict.Type;

// ---------- stage eval plumbing ----------

export const StageKind = Schema.Literals([
	"asr_vs_gold",
	"cleanup_audit",
	"approval_delta",
	"anamnesis_field",
]);
export type StageKind = typeof StageKind.Type;

export const StageMetrics = Schema.Struct({
	wer: Schema.Number,
	cer: Schema.Number,
	criticalErrors: Schema.Number,
	entityVerdicts: Schema.Array(EntityVerdict),
	/** Attribution — lets aggregation reports group without joining
	 * back to the sample row. */
	stage: Schema.optionalKey(Schema.String),
	sampleId: Schema.optionalKey(Schema.String),
	runId: Schema.optionalKey(Schema.String),
});
export type StageMetrics = typeof StageMetrics.Type;

// ---------- persisted eval artifacts ----------

/** Reversible edit list as Schema — diff.ts owns the apply/diff
 * logic; the shape lives here so diffs are storable + decodable
 * (`diffRef` points at a real artifact). */
export const EditOp = Schema.Struct({
	at: Schema.Number,
	remove: Schema.String,
	insert: Schema.String,
	kind: Schema.Literals(["fix", "punct", "entity", "format"]),
	flagged: Schema.optionalKey(Schema.Boolean),
});
export type EditOp = typeof EditOp.Type;

export const EditList = Schema.Struct({
	ops: Schema.Array(EditOp),
});
export type EditList = typeof EditList.Type;

/** One confidence-tagged segment and whether it matched gold — the
 * input to calibration. */
export const ConfSegment = Schema.Struct({
	confidence: Schema.optionalKey(Schema.Number),
	correct: Schema.Boolean,
});
export type ConfSegment = typeof ConfSegment.Type;

/** Per-sample eval outcome — the row the platform exists to persist.
 * One per (runId, sampleId). */
export const SampleResult = Schema.Struct({
	runId: Schema.String,
	sampleId: Schema.String,
	datasetVersion: Schema.optionalKey(Schema.String),
	asrText: Schema.String,
	correctedText: Schema.optionalKey(Schema.String),
	edits: Schema.optionalKey(EditList),
	asrMetrics: Schema.optionalKey(StageMetrics),
	correctedMetrics: Schema.optionalKey(StageMetrics),
	editVerdicts: Schema.Array(EditVerdict),
	confSegments: Schema.Array(ConfSegment),
	createdAt: Schema.Number,
});
export type SampleResult = typeof SampleResult.Type;

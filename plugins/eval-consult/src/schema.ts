import { Schema } from "effect";

import { ConfSegment, EditList } from "@ktb/eval-core";

// Generic contracts moved to @ktb/eval-core (P-074) — re-exported here
// so `@ktb/eval-consult` and `@ktb/eval-consult/schema` keep their
// public surface. ConfSegment/EditList are also value-imported above
// for the domain structs below.
export {
	BlobMeta,
	ConfSegment,
	EditList,
	EditOp,
	EvalAnswer,
	EvalQuestion,
	RunRecord,
} from "@ktb/eval-core";

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

/** `unknown` matches BlobMeta's conservative default — a sample or
 * blob whose provenance was never declared. Untrusted for egress:
 * the PHI policy (phi.ts) scrubs its text and refuses its audio on
 * egress-capable ports exactly like `real_anonymized`. */
export const SampleOrigin = Schema.Literals(["synthetic", "real_anonymized", "unknown"]);
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

/** Phase-2 gate: real consults cannot enter the dataset without these.
 * String fields are NonEmptyString — an empty provenance value is not
 * provenance (L14). */
export const Provenance = Schema.Struct({
	sourcePartner: Schema.optionalKey(Schema.NonEmptyString),
	anonymizationMethod: Schema.optionalKey(Schema.NonEmptyString),
	lgpdBasis: Schema.optionalKey(Schema.NonEmptyString),
	consentRef: Schema.optionalKey(Schema.NonEmptyString),
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
 * every adapter boundary that decodes enforces it for free.
 * Per-stage artifacts and run bookkeeping are NOT stored here:
 * `SampleResult` already persists asrText/correctedText/edits/
 * metrics per run, and batch status lives on `BatchOutcome`, not the
 * manifest (the old `stages`/`status`/`error` fields were write-only
 * and removed). */
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
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(s) =>
				s.origin !== "real_anonymized" ||
				(s.provenance?.consentRef !== undefined &&
					s.provenance?.anonymizationMethod !== undefined &&
					s.provenance?.sourcePartner !== undefined &&
					s.provenance?.lgpdBasis !== undefined) ||
				"real_anonymized samples require provenance: sourcePartner, anonymizationMethod, consentRef, lgpdBasis",
		),
	),
);
export type Sample = typeof Sample.Type;

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

// ---------- derived verdicts ----------

export const EntityStatus = Schema.Literals([
	"correct",
	// "substituted"/"invented" are reserved for judge verdicts — the
	// current noul-only question set cannot distinguish them from
	// "dropped" yet (richer questions are future work).
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
	/** NORMALIZATION_PROFILE the wer/cer were computed under — a
	 * stored score is meaningless without it. */
	normalization: Schema.optionalKey(Schema.String),
});
export type StageMetrics = typeof StageMetrics.Type;

// ---------- persisted eval artifacts ----------

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

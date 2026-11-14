import { Schema } from "effect";

/**
 * Eval-core schema — the GENERIC contracts every eval suite shares:
 * run traceability, blob provenance, reversible edit lists, confidence
 * segments, and the typed decision-model question/answer pair.
 *
 * Domain manifests (samples, personas, clinical verdicts, stage
 * metrics) live in domain packs — this file must stay free of any
 * domain vocabulary. No provider names live here — engines/models
 * arrive as opaque strings from adapters.
 */

/** Provenance stamped on a stored blob at write time (`putBlob` meta).
 * `unknown` is the conservative default when a caller stores bytes
 * without declaring an origin — enforcement adapters treat it as
 * non-synthetic. `null` from `getBlobMeta` means NO record exists
 * (the URI never went through the store) — a different, documented
 * bypass: the bytes live somewhere the store cannot see. */
export const BlobMeta = Schema.Struct({
	origin: Schema.Literals(["synthetic", "real_anonymized", "unknown"]),
});
export type BlobMeta = typeof BlobMeta.Type;

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

import { Schema } from "effect";

/**
 * Eval-core schema — the GENERIC contracts every eval suite shares:
 * run traceability, blob provenance, reversible edit lists, confidence
 * segments, and the typed decision-model question/answer pair.
 *
 * Domain-specific manifests (samples, profiles, verdicts, stage
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
	/** Engine/build identity for drift detection (P-076): adapters
	 * record an opaque version or endpoint hash when they have one —
	 * e.g. the ACP endpoint hash, a service build id. Absent = the
	 * adapter has no version signal, never guessed. */
	engineVersion: Schema.optionalKey(Schema.String),
	inputHash: Schema.String,
	seed: Schema.optionalKey(Schema.Number),
	latencyMs: Schema.optionalKey(Schema.Number),
	startedAt: Schema.Number,
	/** Attribution + reproducibility — the fields that make a run
	 * record an audit artifact rather than a log line. */
	sampleId: Schema.optionalKey(Schema.String),
	datasetVersion: Schema.optionalKey(Schema.String),
	/** Estimated cost of the recorded call — rendered by
	 * `renderRunMarkdown`. Absent = unmetered, never guessed. */
	estCostUsd: Schema.optionalKey(Schema.Number),
});
export type RunRecord = typeof RunRecord.Type;

/** Reversible edit list as Schema — diff.ts owns the apply logic;
 * the shape lives here so edit lists are storable + decodable. */
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

// ---------- market-parity artifacts (P-076) ----------
// Framework-level records: every suite run/generate is an Experiment,
// every generated cohort registers a DatasetManifest, and judge
// calibration emits CalibrationReports. Domain-blind — `summary` and
// `generator` are open JSON bags so each command records what it
// honestly measured without eval-core knowing the vocabulary.

/** Dataset pin — same {id, version} shape as the suite manifest's
 * `dataset` ref (suite.ts SuiteDataset; duplicated here so schema.ts
 * stays import-free of the manifest module). */
export const DatasetPin = Schema.Struct({
	id: Schema.String,
	version: Schema.String,
});
export type DatasetPin = typeof DatasetPin.Type;

/** Gate verdict snapshot an experiment carries once `eval gate`
 * evaluates the run — per-gate accept counts, not per-sample detail
 * (that lives on the SampleResult rows). */
export const ExperimentGate = Schema.Struct({
	id: Schema.String,
	green: Schema.Boolean,
	accepted: Schema.Number,
	total: Schema.Number,
});
export type ExperimentGate = typeof ExperimentGate.Type;

/** One tracked suite invocation — the experiment identity market
 * platforms give every run. `id` is the invocation's own run id
 * (`run-…`/`gen-…`); `manifestHash` + `gitSha` + `profile` +
 * `dataset` are the reproducibility fingerprint; `summary` is the
 * open metrics bag (mean WER, counts, latency — whatever the command
 * measured). */
export const Experiment = Schema.Struct({
	id: Schema.String,
	kind: Schema.Literals(["generate", "run"]),
	suiteId: Schema.String,
	manifestHash: Schema.String,
	gitSha: Schema.optionalKey(Schema.String),
	profile: Schema.String,
	dataset: DatasetPin,
	startedAt: Schema.Number,
	finishedAt: Schema.optionalKey(Schema.Number),
	summary: Schema.JsonObject,
	gates: Schema.optionalKey(Schema.Array(ExperimentGate)),
});
export type Experiment = typeof Experiment.Type;

/** Registered dataset — written by `eval generate` next to the
 * samples. `id`+`version` is the registry key (unique per workdir
 * store); `contentHash` pins the actual cohort so a same-version
 * regeneration with different content is rejected, not silently
 * overwritten. `generator` records the params that produced it
 * (matrix/seed/locale/template/…), `provenance` who/what made it. */
export const DatasetManifest = Schema.Struct({
	id: Schema.String,
	version: Schema.String,
	domain: Schema.String,
	generator: Schema.JsonObject,
	provenance: Schema.optionalKey(Schema.JsonObject),
	createdAt: Schema.Number,
	sampleCount: Schema.Number,
	contentHash: Schema.String,
});
export type DatasetManifest = typeof DatasetManifest.Type;

/** Per-kind agreement bucket — `kind` is the EvalQuestion kind
 * ("noul"/"choice"/"score"); kinds without gold simply never appear. */
export const CalibrationKindStat = Schema.Struct({
	kind: Schema.String,
	n: Schema.Number,
	agreements: Schema.Number,
	agreementRate: Schema.Number,
});
export type CalibrationKindStat = typeof CalibrationKindStat.Type;

/** Probability calibration bucket over judge-vs-gold agreement —
 * same shape as the domain pack's ConfBucket but generic (eval-core
 * cannot import it). `lo`/`hi` = -1 marks the unscored bucket. */
export const CalibrationBucket = Schema.Struct({
	lo: Schema.Number,
	hi: Schema.Number,
	count: Schema.Number,
	agreements: Schema.Number,
	agreementRate: Schema.Number,
});
export type CalibrationBucket = typeof CalibrationBucket.Type;

/** Judge identity observed while calibrating — engine + optional
 * model, deduped across the run's judge RunRecords. */
export const CalibrationJudge = Schema.Struct({
	engine: Schema.String,
	model: Schema.optionalKey(Schema.String),
});
export type CalibrationJudge = typeof CalibrationJudge.Type;

/** Judge-vs-gold calibration report (`eval calibrate`) — agreement
 * stats per question kind, probability buckets, and the Wilson
 * lower bound on pooled agreement. `lowerBound` is the guaranteed
 * floor the gate-policy vision (M2) consumes for threshold
 * recommendations. */
export const CalibrationReport = Schema.Struct({
	id: Schema.String,
	suiteId: Schema.String,
	dataset: DatasetPin,
	runId: Schema.optionalKey(Schema.String),
	createdAt: Schema.Number,
	samples: Schema.Number,
	questions: Schema.Number,
	agreements: Schema.Number,
	agreementRate: Schema.Number,
	lowerBound: Schema.Number,
	kinds: Schema.Array(CalibrationKindStat),
	buckets: Schema.Array(CalibrationBucket),
	judges: Schema.Array(CalibrationJudge),
});
export type CalibrationReport = typeof CalibrationReport.Type;

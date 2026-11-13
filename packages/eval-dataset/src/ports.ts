import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { EditList } from "./diff.ts";
import type {
	AcousticProfile,
	AsrResult,
	AudioRef,
	EvalAnswer,
	EvalQuestion,
	RunRecord,
	Sample,
	SampleResult,
} from "./schema.ts";

/**
 * Eval-dataset ports — hexagonal boundary. The domain pipeline
 * (pipeline.ts) talks only to these tags; adapters (eval-dataset-stub,
 * -local, -cloud) provide the layers. No platform APIs, no provider
 * literals.
 */

/** Single shared failure type — the port name identifies which
 * adapter failed; `cause` chains for diagnostics. */
export class PortError extends Data.TaggedError("PortError")<{
	readonly port: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/** Synthesize a script into audio under an acoustic profile
 * (voice + degradation are decided by the caller via profile). */
export class TtsPort extends Context.Service<
	TtsPort,
	{
		readonly synthesize: (input: {
			readonly script: string;
			readonly voiceId: string;
			readonly acoustic: AcousticProfile;
		}) => Effect.Effect<{ audio: AudioRef; record: RunRecord }, PortError>;
	}
>()("@ktb/eval-dataset/TtsPort") {}

/** Speech-to-text: audio ref → text + confidence-tagged segments. */
export class AsrPort extends Context.Service<
	AsrPort,
	{
		readonly transcribe: (
			audio: AudioRef,
			opts?: { readonly language?: string },
		) => Effect.Effect<{ asr: AsrResult; record: RunRecord }, PortError>;
	}
>()("@ktb/eval-dataset/AsrPort") {}

/** ACP task envelope — the unit of delegated generation. EVERY
 * generative call goes through this shape (no raw-string shortcuts):
 * the envelope carries identity, output contract, and cost bounds so
 * sessions stay traceable and budgetable. */
export interface TaskEnvelope {
	readonly taskId: string;
	readonly role: "generator" | "corrector";
	readonly input: string;
	/** Declared output contract — ACP sessions validate against it
	 * (e.g. "EditList" for correct). */
	readonly outputSchema: string;
	readonly seed?: number;
	readonly modelHint?: string;
	readonly costBudgetUsd?: number;
}

/** Generative model port — ACP-delegated in live adapters. */
export class LlmPort extends Context.Service<
	LlmPort,
	{
		readonly generate: (
			envelope: TaskEnvelope,
		) => Effect.Effect<{ text: string; record: RunRecord }, PortError>;
		/** Surface correction: returns a reversible edit list, never a
		 * rewritten blob — edits stay auditable/rollback-able. */
		readonly correct: (
			envelope: TaskEnvelope,
		) => Effect.Effect<{ edits: EditList; record: RunRecord }, PortError>;
	}
>()("@ktb/eval-dataset/LlmPort") {}

/** Structured decision port (Jev — System One typed questions).
 * NOT a generative port: answers are bounded typed values with
 * calibrated probabilities. */
export class EvalPort extends Context.Service<
	EvalPort,
	{
		readonly judge: (input: {
			readonly state: unknown;
			readonly questions: readonly EvalQuestion[];
		}) => Effect.Effect<{ answers: readonly EvalAnswer[]; record: RunRecord }, PortError>;
	}
>()("@ktb/eval-dataset/EvalPort") {}

/** Manifest rows + audio blobs. */
export class DatasetStorePort extends Context.Service<
	DatasetStorePort,
	{
		readonly putSample: (sample: Sample) => Effect.Effect<void, PortError>;
		readonly getSample: (id: string) => Effect.Effect<Sample | null, PortError>;
		readonly listSamples: (filter?: {
			readonly origin?: Sample["origin"];
			readonly datasetVersion?: string;
		}) => Effect.Effect<readonly Sample[], PortError>;
		readonly putBlob: (uri: string, bytes: Uint8Array) => Effect.Effect<void, PortError>;
		readonly getBlob: (uri: string) => Effect.Effect<Uint8Array | null, PortError>;
		/** Persisted per-sample eval outcome — the audit trail the
		 * platform exists to keep. */
		readonly putResult: (result: SampleResult) => Effect.Effect<void, PortError>;
		readonly listResults: (filter?: {
			readonly sampleId?: string;
			readonly runId?: string;
		}) => Effect.Effect<readonly SampleResult[], PortError>;
	}
>()("@ktb/eval-dataset/DatasetStorePort") {}

/** Run-record sink + report rendering. */
export class ReportPort extends Context.Service<
	ReportPort,
	{
		readonly append: (record: RunRecord) => Effect.Effect<void, PortError>;
		/** Render a run's report — markdown table via `renderRunMarkdown`
		 * (the shape is part of the contract, not adapter-defined). */
		readonly render: (runId: string) => Effect.Effect<string, PortError>;
	}
>()("@ktb/eval-dataset/ReportPort") {}

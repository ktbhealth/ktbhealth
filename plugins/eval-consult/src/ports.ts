import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { PortError, TaskEnvelope } from "@ktb/eval-core";

import type {
	AcousticProfile,
	AsrResult,
	AudioRef,
	BlobMeta,
	EditList,
	RunRecord,
	Sample,
	SampleOrigin,
	SampleResult,
} from "./schema.ts";

// Generic ports moved to @ktb/eval-core (P-074) — re-exported so
// consumers import the tags from `@ktb/eval-consult` directly.
export { EvalPort, PortError, ReportPort } from "@ktb/eval-core";
export type { TaskEnvelope } from "@ktb/eval-core";

/**
 * Eval-dataset ports — hexagonal boundary. The domain pipeline
 * (pipeline.ts) talks only to these tags; adapters (eval-adapter-stub,
 * -local, -cloud) provide the layers. No platform APIs, no provider
 * literals.
 *
 * The GENERIC ports (PortError, TaskEnvelope, EvalPort, ReportPort)
 * live in @ktb/eval-core; this file keeps the transcription/consult
 * domain ports until the domain pack lands (P-074 phase 2).
 */

/** Synthesize a script into audio under an acoustic profile
 * (voice + degradation are decided by the caller via profile).
 * `egress` declares whether script text may leave the perimeter —
 * hosted TTS endpoints set `true`; absent is treated as egress-capable
 * by the PHI policy (fail closed).
 *
 * WARNING — egress asymmetry: unlike AsrPort (guardAsrPort) and the
 * scrubbed LlmPort/EvalPort inputs, NOTHING structurally gates the
 * text handed to synthesize. generateDataset feeds rendered template
 * output straight in, so a caller that routes real consult text
 * through TtsPort would egress unscrubbed PHI to a hosted voice
 * endpoint. Today the only producer is the synthetic dataset
 * generator — keep it that way. TODO(phase-2): a guardTtsPort
 * mirroring guardAsrPort (scrub-or-refuse on untrusted provenance)
 * once real-audio ingest exists. */
export class TtsPort extends Context.Service<
	TtsPort,
	{
		readonly egress?: boolean;
		readonly synthesize: (input: {
			readonly script: string;
			readonly voiceId: string;
			readonly acoustic: AcousticProfile;
		}) => Effect.Effect<{ audio: AudioRef; record: RunRecord }, PortError>;
	}
>()("@ktb/eval-consult/TtsPort") {}

/** Speech-to-text: audio ref → text + confidence-tagged segments.
 * `origin` is the CALLER-DECLARED provenance (sample manifest) — a
 * hint, not proof. `blobMeta` is the provenance recorded ON the blob
 * itself at `putBlob` time; adapters that egress audio to third
 * parties (cloud ASR) must treat stored `real_anonymized`/`unknown`
 * as non-synthetic and refuse unless explicitly opted in — voice is
 * PHI, only verified-synthetic audio may leave the perimeter.
 * `blobMeta: null` = looked up, no record; `undefined` = caller did
 * not check (the documented file:// bypass).
 *
 * `egress` is the PHI capability declaration enforced structurally by
 * `guardAsrPort` (phi.ts): `true` = audio may leave the box, `false` =
 * local-only, absent = treated as egress-capable (fail closed). Only
 * verified-`synthetic` provenance may reach an egress-capable port —
 * voice is PHI and cannot be scrubbed. */
export class AsrPort extends Context.Service<
	AsrPort,
	{
		readonly egress?: boolean;
		readonly transcribe: (
			audio: AudioRef,
			opts?: {
				readonly language?: string;
				readonly origin?: SampleOrigin;
				readonly blobMeta?: BlobMeta | null;
			},
		) => Effect.Effect<{ asr: AsrResult; record: RunRecord }, PortError>;
	}
>()("@ktb/eval-consult/AsrPort") {}

/** Generative model port — ACP-delegated in live adapters.
 * `egress` declares whether envelope input text may leave the
 * perimeter (remote agent vs in-process); the pipeline only ever sends
 * scrubbed text, so this is informational today — declared for the
 * same structural policy as the other ports. */
export class LlmPort extends Context.Service<
	LlmPort,
	{
		readonly egress?: boolean;
		readonly generate: (
			envelope: TaskEnvelope,
		) => Effect.Effect<{ text: string; record: RunRecord }, PortError>;
		/** Surface correction: returns a reversible edit list, never a
		 * rewritten blob — edits stay auditable/rollback-able. */
		readonly correct: (
			envelope: TaskEnvelope,
		) => Effect.Effect<{ edits: EditList; record: RunRecord }, PortError>;
	}
>()("@ktb/eval-consult/LlmPort") {}

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
		/** `meta.origin` is persisted alongside the bytes — provenance
		 * travels WITH the blob so enforcement adapters can verify it
		 * at read/egress time. Omitting `meta` records `unknown`
		 * (conservative: cloud adapters refuse unverified audio). */
		readonly putBlob: (
			uri: string,
			bytes: Uint8Array,
			meta?: { readonly origin: SampleOrigin },
		) => Effect.Effect<void, PortError>;
		/** Record blob provenance WITHOUT writing bytes — for audio
		 * produced outside the store (TTS workDir files referenced by
		 * `file://` AudioRefs, provider-hosted URLs). Same meta contract
		 * as `putBlob`: omitted origin records `unknown`. This is what
		 * makes `getBlobMeta` answer in the real generate→transcribe
		 * flow (M1). */
		readonly putBlobMeta: (
			uri: string,
			meta?: { readonly origin: SampleOrigin },
		) => Effect.Effect<void, PortError>;
		readonly getBlob: (uri: string) => Effect.Effect<Uint8Array | null, PortError>;
		/** Recorded provenance for a stored blob — `null` when the URI
		 * has no store record (never written, or written before
		 * provenance tracking). */
		readonly getBlobMeta: (uri: string) => Effect.Effect<BlobMeta | null, PortError>;
		/** Persisted per-sample eval outcome — the audit trail the
		 * platform exists to keep. */
		readonly putResult: (result: SampleResult) => Effect.Effect<void, PortError>;
		readonly listResults: (filter?: {
			readonly sampleId?: string;
			readonly runId?: string;
		}) => Effect.Effect<readonly SampleResult[], PortError>;
	}
>()("@ktb/eval-consult/DatasetStorePort") {}

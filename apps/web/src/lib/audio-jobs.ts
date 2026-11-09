import { Schema } from "effect";
import * as Effect from "effect/Effect";

import { EventBus } from "@effect-server-utils/cqrs";
import { ConsultationAudioUpdated } from "@ktb/consultations/api";
import {
	audioJobRecord,
	beginAudioJob,
	completeAudioJob,
	failAudioJob,
	saveCorrectedTranscript,
	type AudioJobRecord,
} from "@ktb/consultations";
import type { DbClient } from "@ktb/db";

import { ai, audioBucket, correctTranscript, db, run } from "#/lib/platform.ts";

/**
 * Async transcription pipeline (P-016/P-017): queue consumer that runs
 * Workers AI whisper-large-v3-turbo on the R2-stored recording, then an
 * LLM cleanup pass producing correctedTranscript alongside the original.
 *
 * Everything here is a system path — no Principal; the job payload is
 * produced by the authenticated upload route and re-validated against
 * the D1 row (owner match) before any work happens.
 */

const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

/**
 * Workers AI rejects oversized audio and chunked transcription is not
 * supported — recordings above this are marked failed, not split.
 * (~25MB is the documented ceiling for a single Whisper call.)
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface AudioJobMessage {
	readonly consultationId: number;
	readonly audioKey: string;
	readonly userId: string;
}

const AudioJobMessageSchema = Schema.Struct({
	consultationId: Schema.Number,
	audioKey: Schema.String,
	userId: Schema.String,
});

const decodeAudioJob = Schema.decodeUnknownSync(AudioJobMessageSchema);

/** Minimal R2 read surface — the real R2Bucket satisfies this. */
interface AudioBucketLike {
	get(key: string): Promise<{ readonly size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface AudioTranscriber {
	run(model: string, inputs: unknown): Promise<unknown>;
}

interface CorrectedTranscript {
	readonly corrected: string;
	readonly engine: string;
}

export interface AudioJobDeps {
	readonly db: DbClient;
	readonly bucket: AudioBucketLike | undefined;
	readonly ai: AudioTranscriber | undefined;
	readonly correctTranscript: (transcript: string) => Promise<CorrectedTranscript | null>;
	/**
	 * Live fan-out for the /platform jobs feed: the consumer is a system
	 * path (no Principal), so the host wires this to a
	 * `ConsultationAudioUpdated` EventBus dispatch through the app
	 * runtime. Optional — tests may omit it; a missing/rejected publish
	 * never fails the job.
	 */
	readonly publishAudioUpdate?: (update: {
		readonly consultationId: number;
		readonly audioStatus: string;
		readonly audioError: string | null;
	}) => Promise<void>;
}

/** btoa without stack overflow on large buffers (chunked fromCharCode). */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/** whisper-large-v3-turbo requires base64 audio (unlike number[] models). */
export function whisperInputs(audioBase64: string) {
	return { audio: audioBase64, language: "pt" };
}

/** Tolerant text extraction across Workers AI response shapes. */
export function extractWhisperText(raw: unknown): string {
	if (typeof raw === "string") return raw;
	if (raw && typeof raw === "object") {
		const r = raw as Record<string, unknown>;
		if (typeof r.text === "string") return r.text;
		if (typeof r.transcription === "string") return r.transcription;
	}
	throw new Error("Workers AI returned an unrecognized transcription shape");
}

export async function transcribeAudio(
	transcriber: AudioTranscriber,
	audio: Uint8Array,
): Promise<string> {
	const raw = await transcriber.run(WHISPER_MODEL, whisperInputs(bytesToBase64(audio)));
	return extractWhisperText(raw);
}

/** Best-effort live notification — publishing is a side channel, so a
 * failure here must never fail (or retry) the transcription job. */
const notify = (
	deps: AudioJobDeps,
	consultationId: number,
	audioStatus: string,
	audioError: string | null = null,
) => deps.publishAudioUpdate?.({ consultationId, audioStatus, audioError }).catch(() => {});

const fail = async (deps: AudioJobDeps, consultationId: number, reason: string) => {
	await failAudioJob(deps.db, consultationId, reason);
	await notify(deps, consultationId, "failed", reason);
};

/**
 * Process one transcription job. Permanent failures (missing row/object,
 * oversized audio, empty result, AI rejection) mark the consultation
 * failed and return; unexpected errors propagate so the queue retries.
 * Idempotent: a consultation already "done" is skipped, so redelivered
 * messages are safe.
 */
export async function processAudioJob(job: AudioJobMessage, deps: AudioJobDeps): Promise<void> {
	const row: AudioJobRecord | null = await audioJobRecord(deps.db, job.consultationId);
	if (row === null) {
		await fail(deps, job.consultationId, "consultation not found");
		return;
	}
	if (row.audioStatus === "done") return; // idempotent skip
	const audioKey = row.audioKey ?? job.audioKey;
	if (!audioKey) {
		await fail(deps, job.consultationId, "no audio key recorded");
		return;
	}
	// The payload is untrusted queue data: the D1 row is the source of
	// truth for ownership and linkage.
	if (row.userId !== null && job.userId !== row.userId) {
		await fail(deps, job.consultationId, "audio job owner mismatch");
		return;
	}
	if (!deps.bucket || !deps.ai) {
		await fail(deps, job.consultationId, "audio pipeline not configured");
		return;
	}

	await beginAudioJob(deps.db, job.consultationId);
	await notify(deps, job.consultationId, "processing");
	const object = await deps.bucket.get(audioKey);
	if (object === null) {
		await fail(deps, job.consultationId, "audio object missing from storage");
		return;
	}
	if (object.size > MAX_AUDIO_BYTES) {
		await fail(
			deps,
			job.consultationId,
			`audio too large for server transcription (${object.size} bytes > ${MAX_AUDIO_BYTES})`,
		);
		return;
	}

	const bytes = new Uint8Array(await object.arrayBuffer());
	let transcript: string;
	try {
		transcript = await transcribeAudio(deps.ai, bytes);
	} catch (error) {
		await fail(deps, job.consultationId, `transcription failed: ${String(error)}`);
		return;
	}
	if (!transcript.trim()) {
		await fail(deps, job.consultationId, "transcription returned empty text");
		return;
	}
	await completeAudioJob(deps.db, job.consultationId, transcript);
	await notify(deps, job.consultationId, "done");

	// P-017: LLM cleanup chained in the same job. Failure leaves
	// correctedTranscript null; audioStatus stays "done".
	try {
		const corrected = await deps.correctTranscript(transcript);
		if (corrected) {
			await saveCorrectedTranscript(
				deps.db,
				job.consultationId,
				corrected.corrected,
				corrected.engine,
			);
		}
	} catch (error) {
		console.warn("transcript cleanup failed; keeping original only", {
			consultationId: job.consultationId,
			error: String(error),
		});
	}
}

export interface QueueMessageLike {
	readonly body: unknown;
	ack(): void;
	retry(): void;
}

const platformDeps = (): AudioJobDeps => ({
	db,
	bucket: audioBucket,
	ai: ai as unknown as AudioTranscriber | undefined,
	correctTranscript: (transcript) => correctTranscript(transcript).catch(() => null),
	// System path — `run` binds no Principal; EventBus.dispatch needs
	// none (subscribers re-check authz on their own read paths).
	publishAudioUpdate: (update) =>
		run(
			Effect.gen(function* () {
				const events = yield* EventBus;
				yield* events.dispatch([
					ConsultationAudioUpdated.make({
						consultationId: update.consultationId,
						audioStatus: update.audioStatus,
						audioError: update.audioError,
					}),
				]);
			}),
		),
});

/**
 * Queue batch handler — invoked from the worker's `queue` export in
 * src/server.ts. Malformed messages are acked (poison), valid jobs that
 * throw unexpectedly are retried by the queue.
 */
export async function handleAudioQueueBatch(
	messages: readonly QueueMessageLike[],
	deps: AudioJobDeps = platformDeps(),
): Promise<void> {
	for (const message of messages) {
		let job: AudioJobMessage;
		try {
			job = decodeAudioJob(message.body);
		} catch {
			message.ack();
			continue;
		}
		try {
			await processAudioJob(job, deps);
			message.ack();
		} catch {
			message.retry();
		}
	}
}

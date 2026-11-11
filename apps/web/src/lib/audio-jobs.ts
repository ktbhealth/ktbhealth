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
import type { AudioJobMessage } from "@ktb/server-fns";

import { runAsTenantId } from "@ktb/tenant";

import {
	ai,
	audioBucket,
	audioTranscribeModel,
	correctTranscript,
	db,
	run,
} from "#/lib/platform.ts";

export type { AudioJobMessage };

/**
 * Async transcription pipeline (P-016/P-017): queue consumer that runs
 * Workers AI whisper-large-v3-turbo on the R2-stored recording, then an
 * LLM cleanup pass producing correctedTranscript alongside the original.
 *
 * Everything here is a system path — no Principal; the job payload is
 * produced by the authenticated upload route and re-validated against
 * the D1 row (owner match) before any work happens.
 */

/**
 * Workers AI rejects oversized audio and chunked transcription is not
 * supported — recordings above this are marked failed, not split.
 * (~25MB is the documented ceiling for a single Whisper call.)
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const AudioJobMessageSchema = Schema.Struct({
	consultationId: Schema.Number,
	audioKey: Schema.String,
	userId: Schema.String,
	// Optional + nullable: pre-tenancy messages carry no tenant_id and
	// decode as personal scope (P-053 phase D backward compat).
	tenantId: Schema.optionalKey(Schema.NullOr(Schema.Number)),
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
	/** Transcription model id — host-resolved deploy config
	 * (AUDIO_TRANSCRIBE_MODEL); defaults to the platform fallback. */
	readonly model?: string;
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
		/** Row's tenant_id (null = personal) — forwarded onto the
		 * `consultation.audioUpdated` event and the rebound tenant scope. */
		readonly tenantId: number | null;
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
	model: string = audioTranscribeModel,
): Promise<string> {
	const raw = await transcriber.run(model, whisperInputs(bytesToBase64(audio)));
	return extractWhisperText(raw);
}

/** Best-effort live notification — publishing is a side channel, so a
 * failure here must never fail (or retry) the transcription job. */
const notify = (
	deps: AudioJobDeps,
	consultationId: number,
	audioStatus: string,
	audioError: string | null,
	tenantId: number | null,
) =>
	deps.publishAudioUpdate?.({ consultationId, audioStatus, audioError, tenantId }).catch(() => {});

const fail = async (
	deps: AudioJobDeps,
	consultationId: number,
	reason: string,
	tenantId: number | null,
) => {
	await failAudioJob(deps.db, consultationId, reason);
	await notify(deps, consultationId, "failed", reason, tenantId);
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
	// Tenant scope for this job (P-053 phase D): the row's tenant_id is
	// authoritative; the payload's tenantId is only a hint for the
	// missing-row path. Missing/absent → null = personal scope.
	const tenantId = row === null ? (job.tenantId ?? null) : row.tenantId;
	if (row === null) {
		await fail(deps, job.consultationId, "consultation not found", tenantId);
		return;
	}
	if (row.audioStatus === "done") return; // idempotent skip
	const audioKey = row.audioKey ?? job.audioKey;
	if (!audioKey) {
		await fail(deps, job.consultationId, "no audio key recorded", tenantId);
		return;
	}
	// The payload is untrusted queue data: the D1 row is the source of
	// truth for ownership and linkage.
	if (row.userId !== null && job.userId !== row.userId) {
		await fail(deps, job.consultationId, "audio job owner mismatch", tenantId);
		return;
	}
	if (!deps.bucket || !deps.ai) {
		await fail(deps, job.consultationId, "audio pipeline not configured", tenantId);
		return;
	}

	await beginAudioJob(deps.db, job.consultationId);
	await notify(deps, job.consultationId, "processing", null, tenantId);
	const object = await deps.bucket.get(audioKey);
	if (object === null) {
		await fail(deps, job.consultationId, "audio object missing from storage", tenantId);
		return;
	}
	if (object.size > MAX_AUDIO_BYTES) {
		await fail(
			deps,
			job.consultationId,
			`audio too large for server transcription (${object.size} bytes > ${MAX_AUDIO_BYTES})`,
			tenantId,
		);
		return;
	}

	const bytes = new Uint8Array(await object.arrayBuffer());
	let transcript: string;
	try {
		transcript = await transcribeAudio(deps.ai, bytes, deps.model);
	} catch (error) {
		await fail(deps, job.consultationId, `transcription failed: ${String(error)}`, tenantId);
		return;
	}
	if (!transcript.trim()) {
		await fail(deps, job.consultationId, "transcription returned empty text", tenantId);
		return;
	}
	await completeAudioJob(deps.db, job.consultationId, transcript);
	await notify(deps, job.consultationId, "done", null, tenantId);

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
	model: audioTranscribeModel,
	correctTranscript: (transcript) => correctTranscript(transcript).catch(() => null),
	// System path — `run` binds no Principal; EventBus.dispatch needs
	// none (subscribers re-check authz on their own read paths).
	publishAudioUpdate: (update) =>
		run(
			// System path — `run` binds no Principal; the tenant scope is
			// rebound explicitly from the job's tenant_id (P-053 phase D)
			// so subscribers see the same fence a request would.
			runAsTenantId(
				update.tenantId,
				Effect.gen(function* () {
					const events = yield* EventBus;
					yield* events.dispatch([
						ConsultationAudioUpdated.make({
							consultationId: update.consultationId,
							audioStatus: update.audioStatus,
							audioError: update.audioError,
							tenantId: update.tenantId,
						}),
					]);
				}),
			),
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
			// Re-bind tenant scope from the message payload before running
			// the job's domain effects (P-053 phase D) — ambient tenant is
			// never inherited into the queue consumer. The audio repo
			// helpers stay unfenced by primary key (system path); the
			// scope matters for anything Effect-level the job triggers
			// (event dispatch, future service calls).
			await run(
				runAsTenantId(
					job.tenantId,
					Effect.promise(() => processAudioJob(job, deps)),
				),
			);
			message.ack();
		} catch {
			message.retry();
		}
	}
}

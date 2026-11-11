export * from "./whisper.ts";
export * from "./whisper-engine.ts";

import { createWhisperMicTranscriber, createWhisperTabTranscriber } from "./whisper.ts";
import { loadWhisper, subscribeWhisper, whisperStatus } from "./whisper-engine.ts";
import type { Transcriber, TranscriptionBackend, TranscriptionDriver } from "@ktb/transcription";

export function createTabAudioTranscriber(): Transcriber {
	return createWhisperTabTranscriber();
}

/** Whisper-backed TranscriptionBackend — injected into views by the host. */
export const whisperBackend: TranscriptionBackend = {
	mic: createWhisperMicTranscriber,
	tab: createWhisperTabTranscriber,
	status: whisperStatus,
	subscribe: subscribeWhisper,
	load: loadWhisper,
};

/**
 * Registry candidate for the Whisper adapter. `supported` probes a
 * throwaway mic transcriber — its getter only checks browser APIs, it
 * never acquires a stream.
 */
export const whisperCandidate: TranscriptionDriver = {
	id: "whisper",
	supported: () => createWhisperMicTranscriber().supported,
	create: () => whisperBackend,
};

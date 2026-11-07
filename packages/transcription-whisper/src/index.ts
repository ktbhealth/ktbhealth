export * from "./whisper.ts";
export * from "./whisper-engine.ts";

import { createWhisperMicTranscriber, createWhisperTabTranscriber } from "./whisper.ts";
import { loadWhisper, subscribeWhisper, whisperStatus } from "./whisper-engine.ts";
import type { Transcriber, TranscriptionBackend } from "@ktb/transcription";

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

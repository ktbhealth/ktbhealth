export * from "./whisper.ts";
export * from "./whisper-engine.ts";

import { createWhisperTabTranscriber } from "./whisper.ts";
import type { Transcriber } from "@ktb/transcription";

export function createTabAudioTranscriber(): Transcriber {
	return createWhisperTabTranscriber();
}

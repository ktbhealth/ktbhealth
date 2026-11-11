import { resolveTranscriptionBackend } from "@ktb/transcription";
import { webSpeechBackend, webSpeechCandidate } from "@ktb/transcription-webspeech";
import { whisperCandidate } from "@ktb/transcription-whisper";

// Documented client-side injection point (see vite.config.ts): backend
// selection is data — the first supported driver wins and array order
// breaks ties, the same rule @ktb/driver-framework applies server-side.
// Web Speech is the last-resort backend when nothing else is eligible.
const resolvedBackend = resolveTranscriptionBackend([whisperCandidate, webSpeechCandidate]);
export const transcriptionBackend = resolvedBackend?.backend ?? webSpeechBackend;
export const prefersWhisper = resolvedBackend?.driverId === "whisper";

import { loadWhisper } from "@ktb/transcription-whisper";

/**
 * Warm the Whisper model in the background so it's (nearly) loaded by the
 * time the doctor starts dictating. Idempotent — `loadWhisper` is a no-op
 * once loading/ready — and deferred to idle so it doesn't compete with
 * first paint. Skipped when the user opted into data saver.
 */
export function prefetchWhisperModel(): void {
	const conn =
		typeof navigator === "undefined"
			? undefined
			: (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
	if (conn?.saveData) return;
	const idle =
		typeof requestIdleCallback === "function"
			? requestIdleCallback
			: (cb: () => void) => {
					setTimeout(cb, 2000);
				};
	idle(() => loadWhisper());
}

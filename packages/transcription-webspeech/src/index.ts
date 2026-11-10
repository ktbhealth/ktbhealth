// Web Speech API transcription adapter — implementation of the
// @ktb/transcription port (browser-native, pt-BR, interim results).
// Exposes a `webSpeechCandidate` for the client-side registry
// in @ktb/transcription; composition roots resolve it via
// `resolveTranscriptionBackend`, never import it from domain code.

import {
	type Transcriber,
	type TranscriptionBackend,
	type TranscriptionDriver,
	type TranscriptEvent,
} from "@ktb/transcription";

/** Minimal shape of the browser SpeechRecognition we rely on. */
interface SpeechRecognitionLike {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	start(): void;
	stop(): void;
	abort(): void;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onerror: ((event: { error?: string }) => void) | null;
	onend: (() => void) | null;
}

interface SpeechRecognitionResultLike {
	readonly isFinal: boolean;
	readonly 0: { transcript: string; confidence?: number };
	readonly length: number;
}

interface SpeechRecognitionEventLike {
	resultIndex: number;
	results: {
		length: number;
		[index: number]: SpeechRecognitionResultLike;
	};
}

declare global {
	interface Window {
		SpeechRecognition?: new () => SpeechRecognitionLike;
		webkitSpeechRecognition?: new () => SpeechRecognitionLike;
	}
}

export class WebSpeechTranscriber implements Transcriber {
	private rec: SpeechRecognitionLike | null = null;

	static isSupported(): boolean {
		return (
			typeof window !== "undefined" &&
			Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition)
		);
	}

	get supported(): boolean {
		return WebSpeechTranscriber.isSupported();
	}

	start(onEvent: (event: TranscriptEvent) => void): void {
		const Ctor =
			typeof window !== "undefined"
				? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
				: undefined;
		if (!Ctor) {
			onEvent({
				type: "error",
				message: "SpeechRecognition is not supported in this browser",
			});
			return;
		}
		const rec = new Ctor();
		this.rec = rec;
		rec.lang = "pt-BR";
		rec.continuous = true;
		rec.interimResults = true;

		rec.onresult = (event: SpeechRecognitionEventLike) => {
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i];
				const text = result[0]?.transcript ?? "";
				if (!text) continue;
				if (result.isFinal) {
					onEvent({
						type: "final",
						text: text.trim(),
						confidence: result[0]?.confidence,
					});
				} else {
					onEvent({ type: "partial", text });
				}
			}
		};
		rec.onerror = (e) =>
			onEvent({
				type: "error",
				message: e.error ?? "speech recognition error",
			});
		rec.onend = () => onEvent({ type: "end" });

		rec.start();
	}

	stop(): void {
		this.rec?.stop();
	}
}

export function createTranscriber(): Transcriber {
	return new WebSpeechTranscriber();
}

/**
 * Tab capture is unavailable on this backend: SpeechRecognition only
 * hears the mic, so a "patient" channel would just duplicate the
 * doctor. The stub reports unsupported and errors on start.
 */
const webSpeechTabTranscriber: Transcriber = {
	supported: false,
	start: (onEvent) =>
		onEvent({ type: "error", message: "tab capture requires the whisper backend" }),
	stop: () => {},
};

/**
 * Web Speech backend — the browser engine needs no worker, so there is
 * no model to load and no engine messages to subscribe to.
 */
export const webSpeechBackend: TranscriptionBackend = {
	mic: () => new WebSpeechTranscriber(),
	tab: () => webSpeechTabTranscriber,
	status: () => ({ state: "idle", device: null }),
	subscribe: () => () => {},
	load: () => {},
};

/** Registry candidate for the Web Speech adapter. */
export const webSpeechCandidate: TranscriptionDriver = {
	id: "webspeech",
	supported: () => WebSpeechTranscriber.isSupported(),
	create: () => webSpeechBackend,
};

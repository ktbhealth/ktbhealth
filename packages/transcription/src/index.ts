/**
 * Transcriber port — client-side speech-to-text.
 *
 * The domain (record page) talks to this interface; adapters decide
 * where recognition happens. First impl: Web Speech API (browser-
 * native, pt-BR, interim results). Future: Whisper API, Deepgram,
 * on-device models — none change the page code.
 */

export type TranscriptEvent =
	| { type: "partial"; text: string }
	| { type: "final"; text: string; confidence?: number }
	| { type: "error"; message: string }
	| { type: "end" };

export interface Transcriber {
	/** Whether this adapter can run in the current environment. */
	readonly supported: boolean;
	start(onEvent: (event: TranscriptEvent) => void): void;
	stop(): void;
	/**
	 * Optional: quality stats of the last finished session. Adapters that
	 * cannot score confidence may omit this — the page then never falls
	 * back to server transcription.
	 */
	sessionStats?(): SessionStats;
	/**
	 * Optional: audio captured during the last session, for server-side
	 * re-transcription when `sessionStats` reports low confidence.
	 * Resolves null when nothing was recorded or the session is live.
	 */
	recording?(): Promise<Blob | null>;
}

export interface SessionStats {
	/** Seconds of audio that passed the speech gate. */
	voicedSec: number;
	/** Total characters emitted as final transcript. */
	chars: number;
}

/** Below this many transcript chars per voiced second, Whisper output is suspect. */
export const FALLBACK_MIN_CHARS_PER_VOICED_SEC = 2.5;
/** Ignore stats from sessions shorter than this — too little signal. */
export const FALLBACK_MIN_VOICED_SEC = 6;

/** Heuristic for ADR-0002: client compute first, server only on fallback. */
export function needsServerFallback(stats: SessionStats): boolean {
	return (
		stats.voicedSec >= FALLBACK_MIN_VOICED_SEC &&
		stats.chars < stats.voicedSec * FALLBACK_MIN_CHARS_PER_VOICED_SEC
	);
}

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
				message: "SpeechRecognition não suportado neste browser",
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

// ---------- engine backend port ----------

export interface TranscriptionEngineMessage {
	readonly type: string;
	readonly id?: string;
	readonly text?: string;
	readonly message?: string;
	readonly device?: string;
	readonly cached?: boolean;
}

export interface TranscriptionStatus {
	readonly state: "idle" | "loading" | "ready";
	readonly device: string | null;
}

/**
 * Client-side transcription backend port. Views depend on this shape;
 * implementations (whisper worker, future engines) are injected by the
 * composition root — never imported by domain packages.
 */
export interface TranscriptionBackend {
	mic(): Transcriber;
	tab(): Transcriber;
	status(): TranscriptionStatus;
	subscribe(fn: (m: TranscriptionEngineMessage) => void): () => void;
	load(): void;
}

/**
 * Transcriber port — client-side speech-to-text.
 *
 * The domain (record page) talks to this interface; adapters decide
 * where recognition happens. Impls live in sibling packages
 * (@ktb/transcription-whisper, @ktb/transcription-webspeech) and are
 * selected through the client-side driver registry below — the port
 * itself stays impl-free.
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

// ---------- client-side backend registry ----------

/**
 * Client-side counterpart of a `@ktb/driver-framework` `Driver`: a
 * candidate transcription backend. Registration order is the
 * deterministic tie-break — {@link resolveTranscriptionBackend} picks
 * the first `supported()` candidate, mirroring `resolveDriver` on the
 * server (first enabled wins).
 */
export interface TranscriptionDriver {
	/** Unique driver name, e.g. "whisper". */
	readonly id: string;
	/** Eligibility predicate — runs in the current browser environment. */
	supported(): boolean;
	/** Build the backend this driver provides. */
	create(): TranscriptionBackend;
}

export interface ResolvedTranscriptionBackend {
	/** `id` of the driver that won resolution. */
	readonly driverId: string;
	readonly backend: TranscriptionBackend;
}

/**
 * Resolve the transcription backend: the first supported candidate in
 * registration order. Returns undefined when no candidate is eligible —
 * callers pick their own last-resort backend.
 *
 * This is currently the ONLY client-side selectable port — the server
 * registry (@ktb/driver-framework) is Layer-shaped and cannot run in the
 * browser bundle, so each client-selectable port keeps its own tiny
 * first-supported-wins resolver. Do NOT extract a shared
 * `@ktb/client-drivers` package for this one consumer; if a second
 * client-side selectable port appears, factor the ~10-line resolver out
 * then.
 */
export function resolveTranscriptionBackend(
	candidates: readonly TranscriptionDriver[],
): ResolvedTranscriptionBackend | undefined {
	const driver = candidates.find((c) => c.supported());
	return driver === undefined ? undefined : { driverId: driver.id, backend: driver.create() };
}

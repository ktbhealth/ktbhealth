import type { SessionStats, Transcriber, TranscriptEvent } from "@ktb/transcription";
import {
	type EngineMessage,
	loadWhisper,
	sendAudio,
	subscribeWhisper,
	whisperStatus,
} from "./whisper-engine.ts";

let nextId = 0;

/**
 * WhisperTranscriber — one adapter, any MediaStream source.
 * Client-side Whisper (transformers.js worker; webgpu → wasm).
 * The SOURCE decides the speaker label — separate streams,
 * free diarization (ADR-0002).
 */
export class WhisperTranscriber implements Transcriber {
	private stream: MediaStream | null = null;
	private ctx: AudioContext | null = null;
	private readonly id = `t${nextId++}`;
	private unsubscribe: (() => void) | null = null;
	private active = false;
	private buffer: Float32Array[] = [];
	private bufferedSec = 0;
	/** Per-block RMS, parallel to `buffer` (block = 4096 samples ≈ 256ms). */
	private rms: number[] = [];
	/** Cut on a pause once we have this much audio… */
	private readonly minChunkSec = 4;
	/** …or force a cut here, even mid-speech. */
	private readonly maxChunkSec = 20;
	private stopping = false;
	private inflight = 0;
	private emit: ((event: TranscriptEvent) => void) | null = null;
	// Session stats for the server-fallback heuristic (ADR-0002).
	private voicedSec = 0;
	private sessionChars = 0;
	// Parallel MediaRecorder capture — only uploaded when confidence is low.
	private recorder: MediaRecorder | null = null;
	private recorderChunks: Blob[] = [];
	private recorderDone: Promise<Blob | null> | null = null;

	constructor(
		private acquire: () => Promise<MediaStream>,
		private hint?: string,
	) {}

	get supported(): boolean {
		return (
			typeof navigator !== "undefined" &&
			typeof Worker !== "undefined" &&
			Boolean(navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices))
		);
	}

	start(onEvent: (event: TranscriptEvent) => void): void {
		if (!this.supported) {
			onEvent({
				type: "error",
				message: "whisper is not supported in this browser",
			});
			return;
		}
		this.stopping = false;
		this.inflight = 0;
		this.emit = onEvent;
		this.voicedSec = 0;
		this.sessionChars = 0;
		this.recorder = null;
		this.recorderChunks = [];
		this.recorderDone = null;
		if (this.hint) onEvent({ type: "partial", text: this.hint });
		void this.boot(onEvent).catch((e) =>
			onEvent({
				type: "error",
				message: e instanceof Error ? e.message : String(e),
			}),
		);
	}

	private async boot(onEvent: (event: TranscriptEvent) => void) {
		this.stream = await this.acquire();
		const audio = this.stream.getAudioTracks()[0];
		if (!audio) {
			this.stop();
			onEvent({ type: "error", message: "stream has no audio" });
			return;
		}
		audio.onended = () => this.stop();
		this.startRecorder(this.stream);
		if (this.stopping) this.recorder?.stop();

		this.active = true;
		this.unsubscribe = subscribeWhisper((msg: EngineMessage) => {
			if (msg.type === "progress") onEvent({ type: "partial", text: `[${msg.message}]` });
			if (msg.type === "ready") onEvent({ type: "partial", text: `[model ready (${msg.device})]` });
			if (msg.type === "text" && msg.id === this.id) {
				this.inflight = Math.max(0, this.inflight - 1);
				const text = msg.text?.trim();
				if (text) {
					this.sessionChars += text.length;
					onEvent({ type: "final", text });
				}
				this.finishIfDone();
			}
			if (msg.type === "error" && (!msg.id || msg.id === this.id)) {
				this.inflight = msg.id ? Math.max(0, this.inflight - 1) : 0;
				onEvent({ type: "error", message: msg.message ?? "whisper error" });
				this.finishIfDone();
			}
		});
		loadWhisper();
		const st = whisperStatus();
		if (st.state === "ready") onEvent({ type: "partial", text: `[model ready (${st.device})]` });

		this.ctx = new AudioContext({ sampleRate: 16000 });
		const src = this.ctx.createMediaStreamSource(this.stream);
		const proc = this.ctx.createScriptProcessor(4096, 1, 1);
		proc.onaudioprocess = (ev) => {
			const data = ev.inputBuffer.getChannelData(0);
			this.buffer.push(new Float32Array(data));
			this.rms.push(rmsOf(data));
			this.bufferedSec += data.length / 16000;
			const tail = this.rms.slice(-2);
			const paused = tail.length === 2 && tail.every((r) => r < SILENCE_RMS);
			if (this.bufferedSec >= this.maxChunkSec || (this.bufferedSec >= this.minChunkSec && paused))
				this.flush();
		};
		src.connect(proc);
		proc.connect(this.ctx.destination);
	}

	private flush() {
		if (!this.active || !this.buffer.length) return;
		// Silence/noise gate: Whisper hallucinates phrases on non-speech audio.
		const blocks = this.rms;
		const voiced = blocks.filter((r) => r > VOICE_RMS).length;
		const loud = Math.max(0, ...blocks) > PEAK_RMS;
		if (!loud || voiced / blocks.length < MIN_VOICED_RATIO) {
			console.log("[whisper] speechless segment — discarded");
			this.buffer = [];
			this.rms = [];
			this.bufferedSec = 0;
			return;
		}
		const total = this.buffer.reduce((n, b) => n + b.length, 0);
		const pcm = new Float32Array(total);
		let off = 0;
		for (const b of this.buffer) {
			pcm.set(b, off);
			off += b.length;
		}
		this.buffer = [];
		this.rms = [];
		this.bufferedSec = 0;
		this.inflight++;
		this.voicedSec += total / 16000;
		console.log(`[whisper] sending ${(total / 16000).toFixed(1)}s of audio`);
		sendAudio(this.id, pcm);
	}

	/** After stop(): release the worker once every queued chunk is transcribed. */
	private finishIfDone() {
		if (!this.stopping || this.inflight > 0) return;
		// the shared worker stays alive: model is loaded once per page
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.active = false;
		this.emit?.({ type: "end" });
	}

	/** Quality stats of the current/last session — read after `end`. */
	sessionStats(): SessionStats {
		return { voicedSec: this.voicedSec, chars: this.sessionChars };
	}

	/** Last session's audio blob; null while still recording or if unsupported. */
	recording(): Promise<Blob | null> {
		if (this.recorder && this.recorder.state === "recording") return Promise.resolve(null);
		return this.recorderDone ?? Promise.resolve(null);
	}

	private startRecorder(stream: MediaStream) {
		if (typeof MediaRecorder === "undefined") return;
		try {
			this.recorderChunks = [];
			const rec = new MediaRecorder(stream);
			this.recorder = rec;
			rec.ondataavailable = (e) => {
				if (e.data.size) this.recorderChunks.push(e.data);
			};
			this.recorderDone = new Promise<Blob | null>((resolve) => {
				rec.onstop = () =>
					resolve(
						this.recorderChunks.length
							? new Blob(this.recorderChunks, { type: rec.mimeType })
							: null,
					);
			});
			rec.start(1000);
		} catch {
			this.recorder = null;
		}
	}

	stop(): void {
		if (this.stopping) return;
		this.stopping = true;
		this.flush();
		if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
		for (const t of this.stream?.getTracks() ?? []) t.stop();
		void this.ctx?.close();
		this.stream = null;
		this.ctx = null;
		if (this.inflight === 0) this.finishIfDone();
		else this.emit?.({ type: "partial", text: "[finalizing transcription…]" });
	}
}

const SILENCE_RMS = 0.012; // below this a block counts as a pause
const VOICE_RMS = 0.02; // above this a block counts as speech
const PEAK_RMS = 0.04; // chunk needs at least one block this loud
const MIN_VOICED_RATIO = 0.2; // …and ≥20% of blocks voiced

function rmsOf(data: Float32Array): number {
	let sum = 0;
	for (const v of data) sum += v * v;
	return Math.sqrt(sum / data.length);
}

const micStream = () =>
	navigator.mediaDevices.getUserMedia({
		audio: { echoCancellation: true, noiseSuppression: true },
	});

const tabStream = async () => {
	const s = await navigator.mediaDevices.getDisplayMedia({
		video: true,
		audio: { echoCancellation: false, noiseSuppression: false },
	});
	for (const t of s.getVideoTracks()) t.stop();
	return s;
};

export function createWhisperMicTranscriber(): Transcriber {
	return new WhisperTranscriber(micStream);
}

export function createWhisperTabTranscriber(): Transcriber {
	return new WhisperTranscriber(tabStream, "[select the teleconsult tab and enable 'share audio']");
}

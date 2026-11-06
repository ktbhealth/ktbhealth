import type { Transcriber, TranscriptEvent } from "./index.ts";

/**
 * WhisperTranscriber — one adapter, any MediaStream source.
 * Client-side Whisper (transformers.js worker; webgpu → wasm).
 * The SOURCE decides the speaker label — separate streams,
 * free diarization (ADR-0002).
 */
export class WhisperTranscriber implements Transcriber {
	private stream: MediaStream | null = null;
	private ctx: AudioContext | null = null;
	private worker: Worker | null = null;
	private buffer: Float32Array[] = [];
	private bufferedSec = 0;
	private readonly chunkSec = 8;
	private stopping = false;

	constructor(
		private acquire: () => Promise<MediaStream>,
		private hint?: string,
	) {}

	get supported(): boolean {
		return (
			typeof navigator !== "undefined" &&
			typeof Worker !== "undefined" &&
			Boolean(navigator.mediaDevices?.getUserMedia)
		);
	}

	start(onEvent: (event: TranscriptEvent) => void): void {
		if (!this.supported) {
			onEvent({
				type: "error",
				message: "whisper não suportado neste browser",
			});
			return;
		}
		this.stopping = false;
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
			onEvent({ type: "error", message: "stream sem áudio" });
			return;
		}
		audio.onended = () => this.stop();

		this.worker = new Worker(new URL("./whisper-worker.ts", import.meta.url), {
			type: "module",
		});
		this.worker.onmessage = (e: MessageEvent) => {
			const msg = e.data as {
				type: string;
				text?: string;
				message?: string;
				device?: string;
			};
			if (msg.type === "progress")
				onEvent({ type: "partial", text: `[${msg.message}]` });
			if (msg.type === "ready")
				onEvent({ type: "partial", text: `[modelo pronto — ${msg.device}]` });
			if (msg.type === "text" && msg.text?.trim()) {
				onEvent({ type: "final", text: msg.text.trim() });
			}
			if (msg.type === "error")
				onEvent({ type: "error", message: msg.message ?? "whisper error" });
		};
		this.worker.postMessage({ type: "load", device: "webgpu" });

		this.ctx = new AudioContext({ sampleRate: 16000 });
		const src = this.ctx.createMediaStreamSource(this.stream);
		const proc = this.ctx.createScriptProcessor(4096, 1, 1);
		proc.onaudioprocess = (ev) => {
			const data = ev.inputBuffer.getChannelData(0);
			this.buffer.push(new Float32Array(data));
			this.bufferedSec += data.length / 16000;
			if (this.bufferedSec >= this.chunkSec) this.flush();
		};
		src.connect(proc);
		proc.connect(this.ctx.destination);
	}

	private flush() {
		if (!this.worker || !this.buffer.length) return;
		const total = this.buffer.reduce((n, b) => n + b.length, 0);
		const pcm = new Float32Array(total);
		let off = 0;
		for (const b of this.buffer) {
			pcm.set(b, off);
			off += b.length;
		}
		this.buffer = [];
		this.bufferedSec = 0;
		this.worker.postMessage({ type: "audio", pcm, language: "portuguese" });
	}

	stop(): void {
		if (this.stopping) return;
		this.stopping = true;
		this.flush();
		for (const t of this.stream?.getTracks() ?? []) t.stop();
		void this.ctx?.close();
		this.stream = null;
		this.ctx = null;
	}
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
	return new WhisperTranscriber(
		tabStream,
		"[selecione a aba da teleconsulta e marque 'compartilhar áudio']",
	);
}

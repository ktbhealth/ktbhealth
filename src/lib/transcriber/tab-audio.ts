import type { Transcriber, TranscriptEvent } from "./index.ts";

/**
 * TabAudioTranscriber — captures the teleconsult tab's audio via
 * getDisplayMedia and transcribes it client-side with Whisper
 * (transformers.js in a worker; webgpu → wasm).
 *
 * Separate stream = separate speaker label for free (ADR-0002):
 * whatever comes through this adapter IS the patient.
 */
export class TabAudioTranscriber implements Transcriber {
	private stream: MediaStream | null = null;
	private ctx: AudioContext | null = null;
	private worker: Worker | null = null;
	private buffer: Float32Array[] = [];
	private bufferedSec = 0;
	private readonly chunkSec = 8;
	private stopping = false;

	get supported(): boolean {
		return (
			typeof navigator !== "undefined" &&
			"mediaDevices" in navigator &&
			"getDisplayMedia" in navigator.mediaDevices &&
			typeof Worker !== "undefined"
		);
	}

	start(onEvent: (event: TranscriptEvent) => void): void {
		if (!this.supported) {
			onEvent({
				type: "error",
				message: "captura de aba não suportada neste browser",
			});
			return;
		}
		this.stopping = false;
		onEvent({
			type: "partial",
			text: "[selecione a aba da teleconsulta e marque 'compartilhar áudio']",
		});
		void this.boot(onEvent).catch((e) =>
			onEvent({
				type: "error",
				message: e instanceof Error ? e.message : String(e),
			}),
		);
	}

	private async boot(onEvent: (event: TranscriptEvent) => void) {
		this.stream = await navigator.mediaDevices.getDisplayMedia({
			video: true,
			audio: { echoCancellation: false, noiseSuppression: false },
		});
		// We only need the audio — stop the video track immediately.
		for (const t of this.stream.getVideoTracks()) t.stop();
		const audio = this.stream.getAudioTracks()[0];
		if (!audio) {
			this.stop();
			onEvent({
				type: "error",
				message: "aba compartilhada sem áudio — marque 'compartilhar áudio'",
			});
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

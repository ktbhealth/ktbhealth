/**
 * Whisper engine — ONE shared worker for the whole page.
 *
 * The model is downloaded once (transformers.js keeps the files in the
 * browser Cache API, key "transformers-cache") and loaded into memory
 * once per page. Mic and tab transcribers share it; audio chunks are
 * tagged with the caller's id so results route back to the right one.
 */

export interface EngineMessage {
	type: string;
	id?: string;
	text?: string;
	message?: string;
	device?: string;
	cached?: boolean;
}

export type EngineState = "idle" | "loading" | "ready";

let worker: Worker | null = null;
let state: EngineState = "idle";
let device: string | null = null;
const subs = new Set<(m: EngineMessage) => void>();

function broadcast(m: EngineMessage) {
	for (const fn of subs) fn(m);
}

function ensureWorker(): Worker {
	if (worker) return worker;
	const w = new Worker(new URL("./whisper-worker.ts", import.meta.url), {
		type: "module",
	});
	w.onmessage = (e: MessageEvent<EngineMessage>) => {
		const m = e.data;
		console.log("[whisper] worker →", m.type, m.message ?? m.text ?? "");
		if (m.type === "ready") {
			state = "ready";
			device = m.device ?? null;
		}
		if (m.type === "load-failed") state = "idle";
		broadcast(m);
	};
	w.onerror = (e) => {
		console.error("[whisper] worker error", e);
		worker = null;
		state = "idle";
		broadcast({
			type: "error",
			message: `worker falhou: ${e.message || "erro ao carregar o script do worker"}`,
		});
	};
	worker = w;
	return w;
}

/** Idempotent: starts loading the model only if not loaded/loading. */
export function loadWhisper(): void {
	if (typeof Worker === "undefined") return;
	const w = ensureWorker();
	if (state !== "idle") return;
	state = "loading";
	w.postMessage({ type: "load" });
}

export function whisperStatus(): { state: EngineState; device: string | null } {
	return { state, device };
}

export function subscribeWhisper(fn: (m: EngineMessage) => void): () => void {
	subs.add(fn);
	return () => {
		subs.delete(fn);
	};
}

export function sendAudio(id: string, pcm: Float32Array): void {
	worker?.postMessage({ type: "audio", id, pcm, language: "portuguese" }, [pcm.buffer]);
}

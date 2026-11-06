/**
 * Whisper worker — runs the ASR pipeline off the main thread.
 * Device fallback: webgpu → wasm. Model cached by the browser
 * (Cache API / IndexedDB) after first download.
 */
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

type TranscriberFn = (
	audio: Float32Array,
	opts?: Record<string, unknown>,
) => Promise<{ text: string }>;

let transcriber: TranscriberFn | null = null;

const MODEL = "onnx-community/whisper-base";

async function load(preferred: string) {
	const devices = preferred === "wasm" ? ["wasm"] : ["webgpu", "wasm"];
	let lastErr: unknown = null;
	for (const d of devices) {
		try {
			postMessage({ type: "progress", message: `carregando modelo (${d})…` });
			transcriber = (await pipeline("automatic-speech-recognition", MODEL, {
				device: d as "webgpu" | "wasm",
			})) as unknown as TranscriberFn;
			postMessage({ type: "ready", device: d });
			return;
		} catch (e) {
			lastErr = e;
		}
	}
	postMessage({
		type: "error",
		message: lastErr instanceof Error ? lastErr.message : String(lastErr),
	});
}

self.onmessage = async (e: MessageEvent) => {
	const msg = e.data as {
		type: string;
		pcm?: Float32Array;
		device?: string;
		language?: string;
	};
	if (msg.type === "load") {
		await load(msg.device ?? "webgpu");
		return;
	}
	if (msg.type === "audio" && msg.pcm && transcriber) {
		try {
			const out = await transcriber(msg.pcm, {
				language: msg.language ?? "portuguese",
				task: "transcribe",
			});
			postMessage({ type: "text", text: out.text ?? "" });
		} catch (err) {
			postMessage({
				type: "error",
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}
};

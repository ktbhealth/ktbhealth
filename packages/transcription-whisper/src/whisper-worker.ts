/**
 * Whisper worker — runs the ASR pipeline off the main thread.
 * Device fallback: webgpu → wasm. Model cached by the browser
 * (Cache API / IndexedDB) after first download.
 */
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

// The ort wasm bundle (~26 MB) exceeds the Cloudflare Workers static-asset
// limit, so it is not emitted into dist/client; fetch it from the same CDN
// transformers.js uses by default. Keep in sync with onnxruntime-web.
env.backends.onnx.wasm!.wasmPaths = {
	mjs: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.mjs",
	wasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.wasm",
};

postMessage({ type: "progress", message: "worker started" });

type TranscriberFn = (
	audio: Float32Array,
	opts?: Record<string, unknown>,
) => Promise<{ text: string }>;

let transcriber: TranscriberFn | null = null;

const MODEL = "onnx-community/whisper-base";

/** Are the model files already in the browser cache (no network needed)? */
async function isModelCached(): Promise<boolean> {
	try {
		if (!("caches" in self)) return false;
		const urls = (await (await caches.open(env.cacheKey)).keys()).map((r) => r.url);
		const mine = urls.filter((u) => u.includes(MODEL));
		return mine.some((u) => u.endsWith("config.json")) && mine.some((u) => u.endsWith(".onnx"));
	} catch {
		return false;
	}
}

async function hasWebGpu(): Promise<boolean> {
	try {
		const gpu = (navigator as unknown as { gpu?: GPUish }).gpu;
		return Boolean(gpu && (await gpu.requestAdapter()));
	} catch {
		return false;
	}
}
interface GPUish {
	requestAdapter(): Promise<unknown>;
}

let loading: Promise<void> | null = null;

/** Idempotent: concurrent/repeated loads share one promise. */
function load(): Promise<void> {
	if (transcriber) {
		postMessage({ type: "ready", device: loadedDevice });
		return Promise.resolve();
	}
	loading ??= doLoad().finally(() => {
		loading = null;
	});
	return loading;
}

let loadedDevice = "wasm";

async function doLoad() {
	// keep the cached model from being evicted under storage pressure
	void navigator.storage?.persist?.();
	const cached = await isModelCached();
	postMessage({
		type: "progress",
		message: cached
			? "model cached, loading (no download)"
			: "first use, downloading model (once only)",
	});
	// skip the doomed WebGPU attempt when no adapter exists
	const devices = (await hasWebGpu()) ? ["webgpu", "wasm"] : ["wasm"];
	let lastErr: unknown = null;
	for (const d of devices) {
		try {
			postMessage({ type: "progress", message: `loading model (${d})…` });
			transcriber = (await pipeline("automatic-speech-recognition", MODEL, {
				device: d as "webgpu" | "wasm",
				// quantized weights: much smaller download
				dtype: d === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
				progress_callback: (p: { status?: string; progress?: number }) => {
					if (!cached && typeof p.progress === "number")
						postMessage({
							type: "progress",
							message: `downloading model ${Math.round(p.progress)}%`,
						});
				},
			})) as unknown as TranscriberFn;
			loadedDevice = d;
			postMessage({ type: "ready", device: d });
			return;
		} catch (e) {
			lastErr = e;
			console.error(`[whisper-worker] failed on ${d}`, e);
		}
	}
	postMessage({
		type: "load-failed",
	});
	postMessage({
		type: "error",
		message: lastErr instanceof Error ? lastErr.message : String(lastErr),
	});
}

/** Audio that arrived while the model was still downloading. */
const pending: Array<{ id: string; pcm: Float32Array; language: string }> = [];
let draining = false;

/** Known Whisper hallucinations on non-speech audio (pt). */
const JUNK = [
	/legendas?\s+pel[ao]\s+comunidade/i,
	/amara\.org/i,
	/inscreva-?se/i,
	/^\s*(obrigad[oa]\.?|tchau\.?|até a próxima\.?)\s*$/i,
];

/** Collapse runaway repetition and drop junk. */
function clean(text: string): string {
	const t = text.trim();
	if (!t || JUNK.some((re) => re.test(t))) return "";
	const words = t.split(/\s+/);
	// collapse any 1–6 word phrase repeated 3+ times in a row
	for (let n = 1; n <= 6; n++) {
		for (let i = 0; i + n * 3 <= words.length; i++) {
			const unit = words
				.slice(i, i + n)
				.join(" ")
				.toLowerCase();
			let reps = 1;
			while (
				words
					.slice(i + reps * n, i + (reps + 1) * n)
					.join(" ")
					.toLowerCase() === unit
			)
				reps++;
			if (reps >= 3) words.splice(i + n, (reps - 1) * n);
		}
	}
	return words.join(" ");
}

async function transcribe(id: string, pcm: Float32Array, language: string) {
	/* v8 ignore next -- drain() only calls transcribe when transcriber is set */
	if (!transcriber) return;
	try {
		const out = await transcriber(pcm, {
			language,
			task: "transcribe",
			// greedy + anti-loop: stops "what is what is what is…" runaways
			do_sample: false,
			num_beams: 1,
			no_repeat_ngram_size: 3,
			repetition_penalty: 1.15,
			// ~3 tokens/s of speech is plenty; hard cap bounds any loop
			max_new_tokens: Math.min(220, Math.ceil((pcm.length / 16000) * 6) + 20),
		});
		postMessage({ type: "text", id, text: clean(out.text ?? "") });
	} catch (err) {
		postMessage({
			type: "error",
			id,
			message: err instanceof Error ? err.message : String(err),
		});
	}
}

async function drain() {
	if (draining) return;
	draining = true;
	while (transcriber && pending.length) {
		const next = pending.shift();
		/* v8 ignore next -- shift() is defined while pending.length > 0 */
		if (next) await transcribe(next.id, next.pcm, next.language);
	}
	draining = false;
}

self.onmessage = async (e: MessageEvent) => {
	const msg = e.data as {
		type: string;
		id?: string;
		pcm?: Float32Array;
		language?: string;
	};
	if (msg.type === "load") {
		await load();
		await drain();
		return;
	}
	if (msg.type === "audio" && msg.pcm) {
		pending.push({
			id: msg.id ?? "",
			pcm: msg.pcm,
			language: msg.language ?? "portuguese",
		});
		await drain();
	}
};

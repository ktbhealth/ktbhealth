import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WorkerModule = typeof import("./whisper-worker.ts");

const posted: Array<Record<string, unknown>> = [];
const pipelineCalls: Array<{ model: string; opts: Record<string, unknown> }> = [];
let pipelineImpl: (typeof import("@huggingface/transformers"))["pipeline"];
let envObj: Record<string, unknown>;

const fakeSelf: {
	onmessage: null | ((e: { data: unknown }) => Promise<void> | void);
	caches?: unknown;
} = {
	onmessage: null,
};

async function importWorker() {
	vi.resetModules();
	posted.length = 0;
	pipelineCalls.length = 0;
	await import("./whisper-worker.ts");
	return fakeSelf;
}

function dispatch(self: typeof fakeSelf, data: Record<string, unknown>) {
	return self.onmessage?.({ data });
}

describe("whisper-worker", () => {
	beforeEach(() => {
		fakeSelf.onmessage = null;
		delete fakeSelf.caches;
		envObj = {
			allowLocalModels: true,
			cacheKey: "transformers-cache",
			backends: { onnx: { wasm: {} } },
		};
		pipelineImpl = vi.fn(async (_task: string, _model: string, opts: Record<string, unknown>) => {
			pipelineCalls.push({ model: _model, opts });
			(opts.progress_callback as ((p: { progress: number }) => void) | undefined)?.({
				progress: 50,
			});
			return async (pcm: Float32Array) => ({ text: `texto ${pcm.length}` });
		}) as never;

		vi.doMock("@huggingface/transformers", () => ({
			env: envObj,
			pipeline: (...args: unknown[]) => (pipelineImpl as (...a: unknown[]) => unknown)(...args),
		}));
		vi.stubGlobal("self", fakeSelf);
		vi.stubGlobal("postMessage", (m: Record<string, unknown>) => posted.push(m));
		vi.stubGlobal("navigator", { storage: { persist: vi.fn(async () => true) } });
		vi.stubGlobal("caches", undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.doUnmock("@huggingface/transformers");
	});

	it("announces startup and configures env on import", async () => {
		await importWorker();
		expect(posted[0]).toEqual({ type: "progress", message: "worker started" });
		expect(envObj.allowLocalModels).toBe(false);
		expect(envObj.backends).toMatchObject({ onnx: { wasm: { wasmPaths: expect.anything() } } });
	});

	it("routes model and wasm fetches through the page origin in a browser worker", async () => {
		(fakeSelf as { location?: { origin: string } }).location = { origin: "https://app.ktb.test" };
		try {
			await importWorker();
		} finally {
			delete (fakeSelf as { location?: unknown }).location;
		}
		expect(envObj.remoteHost).toBe("https://app.ktb.test/api/cdn/huggingface/");
		const { wasmPaths } = (
			envObj.backends as { onnx: { wasm: { wasmPaths: Record<string, string> } } }
		).onnx.wasm;
		expect(wasmPaths.mjs).toMatch(
			/^https:\/\/app\.ktb\.test\/api\/cdn\/jsdelivr\/npm\/onnxruntime-web@.+\.mjs$/,
		);
		expect(wasmPaths.wasm).toMatch(
			/^https:\/\/app\.ktb\.test\/api\/cdn\/jsdelivr\/npm\/onnxruntime-web@.+\.wasm$/,
		);
	});

	it("uses the public CDN directly outside a browser worker", async () => {
		await importWorker();
		expect(envObj.remoteHost).toBeUndefined();
		const { wasmPaths } = (
			envObj.backends as { onnx: { wasm: { wasmPaths: Record<string, string> } } }
		).onnx.wasm;
		expect(wasmPaths.wasm).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@/);
	});

	it("load picks wasm when no webgpu, posts ready", async () => {
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		expect(pipelineCalls[0]?.model).toBe("onnx-community/whisper-base");
		expect(pipelineCalls[0]?.opts.device).toBe("wasm");
		expect(posted.some((m) => m.type === "ready" && m.device === "wasm")).toBe(true);
	});

	it("load prefers webgpu when adapter exists", async () => {
		vi.stubGlobal("navigator", {
			storage: { persist: vi.fn(async () => true) },
			gpu: { requestAdapter: vi.fn(async () => ({})) },
		});
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		expect(pipelineCalls[0]?.opts.device).toBe("webgpu");
		expect(posted.some((m) => m.type === "ready" && m.device === "webgpu")).toBe(true);
	});

	it("falls back to wasm when webgpu pipeline fails", async () => {
		vi.stubGlobal("navigator", {
			storage: { persist: vi.fn(async () => true) },
			gpu: { requestAdapter: vi.fn(async () => ({})) },
		});
		pipelineImpl = vi.fn(async (_t: string, _m: string, opts: Record<string, unknown>) => {
			pipelineCalls.push({ model: _m, opts });
			if (opts.device === "webgpu") throw new Error("no webgpu");
			return async () => ({ text: "ok" });
		}) as never;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		// webgpu fails → retried 3× before falling back to wasm
		expect(pipelineCalls.map((c) => c.opts.device)).toEqual(["webgpu", "webgpu", "webgpu", "wasm"]);
		expect(posted.some((m) => m.type === "ready" && m.device === "wasm")).toBe(true);
	});

	it("posts load-failed and error when all devices fail", async () => {
		pipelineImpl = vi.fn(async () => {
			throw new Error("total failure");
		}) as never;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		expect(posted.some((m) => m.type === "load-failed")).toBe(true);
		expect(posted.some((m) => m.type === "error" && m.message === "total failure")).toBe(true);
	});

	it("reports non-Error failure via String()", async () => {
		pipelineImpl = vi.fn(async () => {
			throw "string-fail";
		}) as never;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		expect(posted.some((m) => m.type === "error" && m.message === "string-fail")).toBe(true);
	});

	it("transcribes queued audio after load and cleans junk", async () => {
		const self = await importWorker();
		// audio before load → queued in pending
		await dispatch(self, {
			type: "audio",
			id: "t1",
			pcm: new Float32Array(16000),
			language: "portuguese",
		});
		await dispatch(self, { type: "load" });
		const texts = posted.filter((m) => m.type === "text");
		expect(texts).toHaveLength(1);
		expect(texts[0]).toMatchObject({ id: "t1" });
	});

	it("drops junk transcriptions", async () => {
		pipelineImpl = vi.fn(async () => async () => ({ text: "Inscreva-se no canal!" })) as never;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		await dispatch(self, { type: "audio", id: "t2", pcm: new Float32Array(1600) });
		const texts = posted.filter((m) => m.type === "text");
		expect(texts[0]).toMatchObject({ text: "" });
	});

	it("collapses repeated phrases", async () => {
		pipelineImpl = vi.fn(async () => async () => ({
			text: "o que é o que é o que é o que é fim",
		})) as never;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		await dispatch(self, { type: "audio", id: "t3", pcm: new Float32Array(1600) });
		const texts = posted.filter((m) => m.type === "text");
		expect(String(texts[0]?.text)).not.toContain("o que é o que é o que é");
	});

	it("posts error when transcriber throws", async () => {
		pipelineImpl = vi.fn(async () => async () => {
			throw new Error("asr boom");
		}) as never;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		await dispatch(self, { type: "audio", id: "t4", pcm: new Float32Array(1600) });
		expect(
			posted.some((m) => m.type === "error" && m.id === "t4" && m.message === "asr boom"),
		).toBe(true);
	});

	it("isModelCached returns false when caches API missing", async () => {
		delete fakeSelf.caches;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		expect(posted.some((m) => m.type === "ready")).toBe(true);
	});

	it("audio dispatched while draining hits the re-entrancy guard", async () => {
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		// second audio lands while the first drain is still awaiting the pipeline
		const p1 = dispatch(self, {
			type: "audio",
			id: "t7",
			pcm: new Float32Array(1600),
			language: "portuguese",
		});
		const p2 = dispatch(self, {
			type: "audio",
			id: "t8",
			pcm: new Float32Array(1600),
			language: "portuguese",
		});
		await Promise.all([p1, p2]);
		const texts = posted.filter((m) => m.type === "text");
		expect(texts.map((m) => m.id).sort()).toEqual(["t7", "t8"]);
	});

	it("isModelCached detects cached model files", async () => {
		const cachesMock = {
			open: vi.fn(async () => ({
				keys: async () => [
					{ url: "https://x/onnx-community/whisper-base/config.json" },
					{ url: "https://x/onnx-community/whisper-base/model.onnx" },
					{ url: "https://x/other/file.bin" },
				],
			})),
		};
		fakeSelf.caches = cachesMock;
		vi.stubGlobal("caches", cachesMock);
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		expect(posted.some((m) => m.type === "progress" && String(m.message).includes("cached"))).toBe(
			true,
		);
	});

	it("isModelCached returns false on caches error and partial cache", async () => {
		const cachesMock = {
			open: vi.fn(async () => ({
				keys: async () => [{ url: "https://x/onnx-community/whisper-base/config.json" }],
			})),
		};
		fakeSelf.caches = cachesMock;
		vi.stubGlobal("caches", cachesMock);
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		expect(posted.some((m) => m.type === "ready")).toBe(true);

		// caches.open throws → catch → false
		const self2 = await (async () => {
			vi.resetModules();
			posted.length = 0;
			const badCaches = { open: vi.fn(async () => Promise.reject(new Error("no store"))) };
			fakeSelf.caches = badCaches;
			vi.stubGlobal("caches", badCaches);
			await import("./whisper-worker.ts");
			return fakeSelf;
		})();
		await dispatch(self2, { type: "load" });
		expect(posted.some((m) => m.type === "ready")).toBe(true);
	});

	it("hasWebGpu swallows requestAdapter errors", async () => {
		vi.stubGlobal("navigator", {
			storage: { persist: vi.fn(async () => true) },
			gpu: { requestAdapter: vi.fn(async () => Promise.reject(new Error("no gpu"))) },
		});
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		expect(posted.some((m) => m.type === "ready" && m.device === "wasm")).toBe(true);
	});

	it("second load reuses loaded transcriber", async () => {
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		const before = posted.filter((m) => m.type === "ready").length;
		await dispatch(self, { type: "load" });
		expect(posted.filter((m) => m.type === "ready").length).toBe(before + 1);
		expect(pipelineCalls).toHaveLength(1);
	});

	it("ignores audio messages without pcm", async () => {
		const self = await importWorker();
		await dispatch(self, { type: "audio" });
		await dispatch(self, { type: "load" });
		const texts = posted.filter((m) => m.type === "text");
		expect(texts).toHaveLength(0);
	});

	it("posts empty text when transcriber returns no text", async () => {
		pipelineImpl = vi.fn(async () => async () => ({})) as never;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		await dispatch(self, { type: "audio", id: "t5", pcm: new Float32Array(1600) });
		const texts = posted.filter((m) => m.type === "text");
		expect(texts[0]).toMatchObject({ id: "t5", text: "" });
	});

	it("posts String() error for non-Error transcriber failure", async () => {
		pipelineImpl = vi.fn(async () => async () => {
			throw "whisper-string-boom";
		}) as never;
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		await dispatch(self, { type: "audio", id: "t6", pcm: new Float32Array(1600) });
		expect(
			posted.some(
				(m) => m.type === "error" && m.id === "t6" && m.message === "whisper-string-boom",
			),
		).toBe(true);
	});

	it("audio with missing id/language uses defaults", async () => {
		const self = await importWorker();
		await dispatch(self, { type: "load" });
		await dispatch(self, { type: "audio", pcm: new Float32Array(100) });
		const texts = posted.filter((m) => m.type === "text");
		expect(texts.length).toBeGreaterThan(0);
	});
});

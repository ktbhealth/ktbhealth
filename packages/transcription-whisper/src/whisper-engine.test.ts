import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Engine = typeof import("./whisper-engine.ts");
type EngineMessage = import("./whisper-engine.ts").EngineMessage;

async function freshEngine(): Promise<Engine> {
	vi.resetModules();
	return import("./whisper-engine.ts");
}

class MockWorker {
	static instances: MockWorker[] = [];
	onmessage: ((e: MessageEvent<EngineMessage>) => void) | null = null;
	onerror: ((e: ErrorEvent) => void) | null = null;
	postMessage = vi.fn();
	constructor() {
		MockWorker.instances.push(this);
	}
	emit(msg: EngineMessage) {
		this.onmessage?.({ data: msg } as MessageEvent<EngineMessage>);
	}
	emitError(message = "boom") {
		this.onerror?.({ message } as ErrorEvent);
	}
}

describe("whisper-engine", () => {
	beforeEach(() => {
		MockWorker.instances = [];
		vi.stubGlobal("Worker", MockWorker);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("loadWhisper creates worker, posts load, and tracks state", async () => {
		const { loadWhisper, whisperStatus } = await freshEngine();
		loadWhisper();
		expect(MockWorker.instances).toHaveLength(1);
		const w = MockWorker.instances[0]!;
		expect(w.postMessage).toHaveBeenCalledWith({ type: "load" });
		expect(whisperStatus().state).toBe("loading");

		// second call is idempotent while loading
		loadWhisper();
		expect(MockWorker.instances).toHaveLength(1);

		w.emit({ type: "ready", device: "webgpu" });
		expect(whisperStatus()).toEqual({ state: "ready", device: "webgpu" });

		// ready without device keeps device null-ish
		w.emit({ type: "ready" });
		expect(whisperStatus().device).toBeNull();
		w.emit({ type: "progress", message: "x" });
	});

	it("broadcasts messages to subscribers and unsubscribes", async () => {
		const { loadWhisper, subscribeWhisper } = await freshEngine();
		const got: EngineMessage[] = [];
		const unsub = subscribeWhisper((m) => got.push(m));
		loadWhisper();
		MockWorker.instances[0]!.emit({ type: "progress", message: "loading model" });
		expect(got).toEqual([{ type: "progress", message: "loading model" }]);
		unsub();
		MockWorker.instances[0]!.emit({ type: "progress", message: "again" });
		expect(got).toHaveLength(1);
	});

	it("resets to idle on load-failed", async () => {
		const { loadWhisper, whisperStatus } = await freshEngine();
		loadWhisper();
		MockWorker.instances[0]!.emit({ type: "load-failed" });
		expect(whisperStatus().state).toBe("idle");
	});

	it("resets worker on error and broadcasts error message", async () => {
		const { loadWhisper, subscribeWhisper, whisperStatus } = await freshEngine();
		const got: EngineMessage[] = [];
		subscribeWhisper((m) => got.push(m));
		loadWhisper();
		MockWorker.instances[0]!.emitError("script error");
		expect(whisperStatus().state).toBe("idle");
		expect(got.at(-1)).toEqual({
			type: "error",
			message: "worker falhou: script error",
		});
		// worker reference cleared: next load creates a new one
		loadWhisper();
		expect(MockWorker.instances).toHaveLength(2);
	});

	it("error event without message uses fallback text", async () => {
		const { loadWhisper, subscribeWhisper } = await freshEngine();
		const got: EngineMessage[] = [];
		subscribeWhisper((m) => got.push(m));
		loadWhisper();
		MockWorker.instances[0]!.onerror?.({} as ErrorEvent);
		expect(got.at(-1)).toMatchObject({
			type: "error",
			message: expect.stringContaining("erro ao carregar"),
		});
	});

	it("sendAudio posts to worker when loaded, no-ops otherwise", async () => {
		const { loadWhisper, sendAudio } = await freshEngine();
		sendAudio("t1", new Float32Array([1, 2]));
		loadWhisper();
		const pcm = new Float32Array([0.5]);
		sendAudio("t1", pcm);
		expect(MockWorker.instances[0]!.postMessage).toHaveBeenCalledWith(
			{ type: "audio", id: "t1", pcm, language: "portuguese" },
			[pcm.buffer],
		);
	});

	it("loadWhisper is a no-op without Worker", async () => {
		vi.stubGlobal("Worker", undefined);
		const { loadWhisper, whisperStatus } = await freshEngine();
		expect(() => loadWhisper()).not.toThrow();
		expect(whisperStatus().state).toBe("idle");
	});
});

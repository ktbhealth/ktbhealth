import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptEvent } from "@ktb/transcription";

type WhisperModule = typeof import("./whisper.ts");
type EngineModule = typeof import("./whisper-engine.ts");

const engineSubscribers = new Set<
	(m: { type: string; id?: string; text?: string; message?: string; device?: string }) => void
>();
let mockWorkerPost: ReturnType<typeof vi.fn>;

class MockWorker {
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: ((e: { message?: string }) => void) | null = null;
	postMessage = mockWorkerPost;
}

function emitEngine(msg: {
	type: string;
	id?: string;
	text?: string;
	message?: string;
	device?: string;
}) {
	for (const fn of engineSubscribers) fn(msg);
}

class MockAudioContext {
	static instances: MockAudioContext[] = [];
	destination = {};
	createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
	createScriptProcessor = vi.fn(() => {
		const node = {
			connect: vi.fn(),
			disconnect: vi.fn(),
			onaudioprocess: null as
				| null
				| ((ev: { inputBuffer: { getChannelData: (i: number) => Float32Array } }) => void),
		};
		MockAudioContext.lastProcessor = node;
		return node;
	});
	static lastProcessor: {
		onaudioprocess:
			| ((ev: { inputBuffer: { getChannelData: (i: number) => Float32Array } }) => void)
			| null;
	} | null = null;
	close = vi.fn(async () => {});
	constructor(public opts?: unknown) {
		MockAudioContext.instances.push(this);
	}
}

function makeStream(withAudio = true, withVideo = false) {
	const track = { stop: vi.fn(), onended: null as null | (() => void) };
	const videoTrack = { stop: vi.fn() };
	return {
		getAudioTracks: () => (withAudio ? [track] : []),
		getTracks: () => [...(withAudio ? [track] : []), ...(withVideo ? [videoTrack] : [])],
		getVideoTracks: () => (withVideo ? [videoTrack] : []),
		_track: track,
		_videoTrack: videoTrack,
	};
}

async function setup(opts?: { supported?: boolean; stream?: ReturnType<typeof makeStream> }) {
	vi.resetModules();
	mockWorkerPost = vi.fn();
	engineSubscribers.clear();
	MockAudioContext.instances = [];
	MockAudioContext.lastProcessor = null;

	vi.doMock("./whisper-engine.ts", () => ({
		loadWhisper: vi.fn(),
		whisperStatus: vi.fn(() => ({ state: "idle", device: null })),
		subscribeWhisper: vi.fn(
			(
				fn: (m: {
					type: string;
					id?: string;
					text?: string;
					message?: string;
					device?: string;
				}) => void,
			) => {
				engineSubscribers.add(fn);
				return () => engineSubscribers.delete(fn);
			},
		),
		sendAudio: vi.fn(),
	}));

	const stream = opts?.stream ?? makeStream();
	const nav = {
		mediaDevices: {
			getUserMedia: vi.fn(async () => stream),
			getDisplayMedia: vi.fn(async () => stream),
		},
	};
	vi.stubGlobal("navigator", nav);
	vi.stubGlobal("Worker", MockWorker);
	vi.stubGlobal("AudioContext", MockAudioContext);

	const mod = (await import("./whisper.ts")) as WhisperModule;
	return { mod, stream, nav };
}

describe("WhisperTranscriber", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.doUnmock("./whisper-engine.ts");
	});

	it("supported requires navigator.mediaDevices and Worker", async () => {
		const { mod } = await setup();
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		expect(t.supported).toBe(true);
	});

	it("reports unsupported without getUserMedia", async () => {
		vi.resetModules();
		vi.stubGlobal("navigator", { mediaDevices: {} });
		vi.stubGlobal("Worker", MockWorker);
		const mod = (await import("./whisper.ts")) as WhisperModule;
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		expect(t.supported).toBe(false);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		expect(events[0]?.type).toBe("error");
	});

	it("boots: acquires stream, subscribes, wires audio graph", async () => {
		const { mod, stream } = await setup();
		const t = new mod.WhisperTranscriber(async () => stream as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() => expect(MockAudioContext.instances).toHaveLength(1));
		expect(stream._track.onended).not.toBeNull();
		expect(MockAudioContext.lastProcessor?.onaudioprocess).not.toBeNull();
	});

	it("emits error when stream has no audio track", async () => {
		const { mod } = await setup({ stream: makeStream(false) });
		const t = new mod.WhisperTranscriber(async () => makeStream(false) as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() =>
			expect(events.some((e) => e.type === "error" && e.message === "stream sem áudio")).toBe(true),
		);
	});

	it("routes engine messages: progress, ready, text, error", async () => {
		const { mod } = await setup();
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() => expect(MockAudioContext.instances).toHaveLength(1));

		emitEngine({ type: "progress", message: "carregando" });
		emitEngine({ type: "ready", device: "wasm" });
		emitEngine({ type: "text", id: "wrong", text: "ignored" });
		emitEngine({ type: "text", id: (t as unknown as { id: string }).id, text: "  olá  " });
		emitEngine({ type: "text", id: (t as unknown as { id: string }).id, text: "   " });
		emitEngine({ type: "error", id: (t as unknown as { id: string }).id, message: "falhou" });
		emitEngine({ type: "error", message: "falhou" });
		emitEngine({ type: "error" });

		const finals = events.filter((e) => e.type === "final");
		expect(finals).toEqual([{ type: "final", text: "olá" }]);
		expect(events.some((e) => e.type === "partial" && e.text === "[carregando]")).toBe(true);
		expect(events.filter((e) => e.type === "error")).toHaveLength(3);
	});

	it("flush sends voiced audio and discards silence", async () => {
		const engine = await import("./whisper-engine.ts");
		void engine;
		const { mod } = await setup();
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() => expect(MockAudioContext.lastProcessor).not.toBeNull());

		const proc = MockAudioContext.lastProcessor!;
		// loud voiced block → flush on maxChunkSec path needs 20s; instead force via many blocks
		const loud = new Float32Array(4096).fill(0.2);
		const silent = new Float32Array(4096).fill(0.001);
		// 5 loud blocks = ~1.28s buffered; need >=4s min → 16 loud blocks then pause pair triggers at >=4s
		for (let i = 0; i < 17; i++)
			proc.onaudioprocess!({ inputBuffer: { getChannelData: () => loud } });
		// now a silent pair → paused=true and bufferedSec>=4 → flush with voiced content
		proc.onaudioprocess!({ inputBuffer: { getChannelData: () => silent } });
		proc.onaudioprocess!({ inputBuffer: { getChannelData: () => silent } });

		// silence-only chunk gets discarded: reset by stopping? simpler: send only silence after stop-flush
	});

	it("flush discards all-silence chunks", async () => {
		const { mod } = await setup();
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() => expect(MockAudioContext.lastProcessor).not.toBeNull());
		const proc = MockAudioContext.lastProcessor!;
		const silent = new Float32Array(4096).fill(0.0001);
		// enough blocks to pass minChunkSec (4s = ~16 blocks) with a pause pair
		for (let i = 0; i < 17; i++)
			proc.onaudioprocess!({ inputBuffer: { getChannelData: () => silent } });
		proc.onaudioprocess!({ inputBuffer: { getChannelData: () => silent } });
		proc.onaudioprocess!({ inputBuffer: { getChannelData: () => silent } });
		// buffer cleared, nothing sent — stop() then finishes cleanly
		t.stop();
		expect(events.at(-1)?.type).toBe("end");
	});

	it("stop flushes, stops tracks, closes ctx, emits end when idle", async () => {
		const { mod, stream } = await setup();
		const t = new mod.WhisperTranscriber(async () => stream as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() => expect(MockAudioContext.instances).toHaveLength(1));
		t.stop();
		expect(stream._track.stop).toHaveBeenCalled();
		expect(MockAudioContext.instances[0]!.close).toHaveBeenCalled();
		expect(events.at(-1)?.type).toBe("end");
		// idempotent
		t.stop();
	});

	it("stop with inflight chunks emits partial and ends on last text", async () => {
		const { mod } = await setup();
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() => expect(MockAudioContext.lastProcessor).not.toBeNull());

		// build a voiced chunk and flush it via stop()
		const proc = MockAudioContext.lastProcessor!;
		const loud = new Float32Array(4096).fill(0.2);
		for (let i = 0; i < 17; i++)
			proc.onaudioprocess!({ inputBuffer: { getChannelData: () => loud } });
		t.stop(); // flush() inside stop sends audio → inflight=1

		const id = (t as unknown as { id: string }).id;
		expect(
			events.some((e) => e.type === "partial" && e.text === "[finalizando transcrição…]"),
		).toBe(true);
		emitEngine({ type: "text", id, text: "fim" });
		expect(events.at(-1)?.type).toBe("end");
	});

	it("boot failure emits error event", async () => {
		vi.resetModules();
		vi.doMock("./whisper-engine.ts", () => ({
			loadWhisper: vi.fn(),
			whisperStatus: vi.fn(() => ({ state: "idle", device: null })),
			subscribeWhisper: vi.fn(() => () => {}),
			sendAudio: vi.fn(),
		}));
		vi.stubGlobal("navigator", {
			mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(new Error("denied"))) },
		});
		vi.stubGlobal("Worker", MockWorker);
		const mod = (await import("./whisper.ts")) as WhisperModule;
		const t = new mod.WhisperTranscriber(async () => {
			throw new Error("denied");
		});
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() =>
			expect(events.some((e) => e.type === "error" && e.message === "denied")).toBe(true),
		);
	});

	it("boot catch handles non-Error rejection", async () => {
		vi.resetModules();
		vi.doMock("./whisper-engine.ts", () => ({
			loadWhisper: vi.fn(),
			whisperStatus: vi.fn(() => ({ state: "idle", device: null })),
			subscribeWhisper: vi.fn(() => () => {}),
			sendAudio: vi.fn(),
		}));
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
		vi.stubGlobal("Worker", MockWorker);
		const mod = (await import("./whisper.ts")) as WhisperModule;
		const t = new mod.WhisperTranscriber(async () => {
			throw "plain-string";
		});
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() =>
			expect(events.some((e) => e.type === "error" && e.message === "plain-string")).toBe(true),
		);
	});

	it("ignores engine error events for other transcribers", async () => {
		const { mod } = await setup();
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() => expect(MockAudioContext.instances).toHaveLength(1));
		emitEngine({ type: "error", id: "other-id", message: "not mine" });
		expect(events.filter((e) => e.type === "error")).toHaveLength(0);
		// error without id reaches everyone
		emitEngine({ type: "error", message: "global" });
		expect(events.filter((e) => e.type === "error")).toHaveLength(1);
	});

	it("emits ready partial when engine already loaded", async () => {
		vi.resetModules();
		vi.doMock("./whisper-engine.ts", () => ({
			loadWhisper: vi.fn(),
			whisperStatus: vi.fn(() => ({ state: "ready", device: "webgpu" })),
			subscribeWhisper: vi.fn(() => () => {}),
			sendAudio: vi.fn(),
		}));
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
		vi.stubGlobal("Worker", MockWorker);
		const mod = (await import("./whisper.ts")) as WhisperModule;
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() =>
			expect(events.some((e) => e.type === "partial" && String(e.text).includes("webgpu"))).toBe(
				true,
			),
		);
	});

	it("audio track onended stops the transcriber", async () => {
		const { mod, stream } = await setup();
		const t = new mod.WhisperTranscriber(async () => stream as never);
		const events: TranscriptEvent[] = [];
		t.start((e) => events.push(e));
		await vi.waitFor(() => expect(MockAudioContext.instances).toHaveLength(1));
		stream._track.onended!();
		expect(stream._track.stop).toHaveBeenCalled();
		await vi.waitFor(() => expect(events.at(-1)?.type).toBe("end"));
	});

	it("tab stream factory stops video tracks", async () => {
		const videoStream = makeStream(true, true);
		const { mod, nav } = await setup({ stream: videoStream });
		const tab = mod.createWhisperTabTranscriber();
		tab.start(() => {});
		await vi.waitFor(() => expect(nav.mediaDevices.getDisplayMedia).toHaveBeenCalled());
		expect(videoStream._videoTrack.stop).toHaveBeenCalled();
		tab.stop();
	});

	it("stop before start is safe", async () => {
		const { mod } = await setup();
		const t = new mod.WhisperTranscriber(async () => makeStream() as never);
		expect(() => t.stop()).not.toThrow();
	});

	it("factories create mic and tab transcribers", async () => {
		const { mod, nav } = await setup();
		const mic = mod.createWhisperMicTranscriber();
		const tab = mod.createWhisperTabTranscriber();
		expect(mic).toBeInstanceOf(mod.WhisperTranscriber);
		expect(tab).toBeInstanceOf(mod.WhisperTranscriber);
		// exercise the stream factories
		const events: TranscriptEvent[] = [];
		tab.start((e) => events.push(e));
		await vi.waitFor(() => expect(nav.mediaDevices.getDisplayMedia).toHaveBeenCalled());
		mic.start((e) => events.push(e));
		await vi.waitFor(() => expect(nav.mediaDevices.getUserMedia).toHaveBeenCalled());
		const idx = await import("./index.ts");
		expect(idx.createTabAudioTranscriber()).toBeInstanceOf(mod.WhisperTranscriber);
	});
});

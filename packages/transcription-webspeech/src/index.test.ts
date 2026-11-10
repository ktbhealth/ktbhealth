import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createTranscriber,
	WebSpeechTranscriber,
	webSpeechBackend,
	webSpeechCandidate,
} from "./index.ts";

describe("WebSpeechTranscriber in node environment", () => {
	it("reports not supported in node environment", () => {
		expect(WebSpeechTranscriber.isSupported()).toBe(false);
		const t = new WebSpeechTranscriber();
		expect(t.supported).toBe(false);
	});

	it("emits error event when starting without browser support", () => {
		const t = new WebSpeechTranscriber();
		const events: unknown[] = [];
		t.start((ev) => events.push(ev));
		expect(events).toEqual([
			{
				type: "error",
				message: "SpeechRecognition is not supported in this browser",
			},
		]);
	});

	it("stop is a no-op when recognition was not started", () => {
		const t = new WebSpeechTranscriber();
		expect(() => t.stop()).not.toThrow();
	});
});

describe("WebSpeechTranscriber with mocked browser SpeechRecognition", () => {
	class MockSpeechRecognition {
		lang = "";
		continuous = false;
		interimResults = false;
		start = vi.fn();
		stop = vi.fn();
		abort = vi.fn();
		onresult: ((event: unknown) => void) | null = null;
		onerror: ((event: { error?: string }) => void) | null = null;
		onend: (() => void) | null = null;
	}

	afterEach(() => {
		// @ts-expect-error test cleanup
		delete globalThis.window;
	});

	it("reports supported when window.SpeechRecognition exists", () => {
		// @ts-expect-error test mock
		globalThis.window = { SpeechRecognition: MockSpeechRecognition };
		expect(WebSpeechTranscriber.isSupported()).toBe(true);
		const t = new WebSpeechTranscriber();
		expect(t.supported).toBe(true);
	});

	it("supports webkitSpeechRecognition fallback", () => {
		// @ts-expect-error test mock
		globalThis.window = { webkitSpeechRecognition: MockSpeechRecognition };
		expect(WebSpeechTranscriber.isSupported()).toBe(true);
		const t = new WebSpeechTranscriber();
		const events: Array<{ type: string; text?: string }> = [];
		t.start((ev) => events.push(ev));
		expect(events).toEqual([]);
		t.stop();
	});

	it("ignores results with no transcript alternative", () => {
		let currentInstance: MockSpeechRecognition | null = null;
		class MockCtor extends MockSpeechRecognition {
			constructor() {
				super();
				currentInstance = this;
			}
		}
		// @ts-expect-error test mock
		globalThis.window = { SpeechRecognition: MockCtor };
		const t = new WebSpeechTranscriber();
		const events: unknown[] = [];
		t.start((ev) => events.push(ev));
		currentInstance!.onresult!({
			resultIndex: 0,
			results: [{ isFinal: true, length: 0 }],
		});
		expect(events).toEqual([]);
	});

	it("handles transcription lifecycle, results and errors", () => {
		let currentInstance: MockSpeechRecognition | null = null;
		class MockCtor extends MockSpeechRecognition {
			constructor() {
				super();
				currentInstance = this;
			}
		}

		// @ts-expect-error test mock
		globalThis.window = { webkitSpeechRecognition: MockCtor };

		const t = new WebSpeechTranscriber();
		const events: unknown[] = [];
		t.start((ev) => events.push(ev));

		expect(currentInstance).not.toBeNull();
		expect(currentInstance!.start).toHaveBeenCalled();
		expect(currentInstance!.lang).toBe("pt-BR");

		// Partial event
		currentInstance!.onresult!({
			resultIndex: 0,
			results: [
				{
					0: { transcript: "olá doutor" },
					isFinal: false,
					length: 1,
				},
			],
		});

		// Final event
		currentInstance!.onresult!({
			resultIndex: 0,
			results: [
				{
					0: { transcript: " dor de cabeça ", confidence: 0.95 },
					isFinal: true,
					length: 1,
				},
			],
		});

		// Empty text ignored
		currentInstance!.onresult!({
			resultIndex: 0,
			results: [
				{
					0: { transcript: "" },
					isFinal: true,
					length: 1,
				},
			],
		});

		// Error event with message
		currentInstance!.onerror!({ error: "network" });
		// Error event without message fallback
		currentInstance!.onerror!({});

		// End event
		currentInstance!.onend!();

		t.stop();
		expect(currentInstance!.stop).toHaveBeenCalled();

		expect(events).toEqual([
			{ type: "partial", text: "olá doutor" },
			{ type: "final", text: "dor de cabeça", confidence: 0.95 },
			{ type: "error", message: "network" },
			{ type: "error", message: "speech recognition error" },
			{ type: "end" },
		]);
	});
});

describe("createTranscriber factory", () => {
	it("returns a WebSpeechTranscriber instance", () => {
		const t = createTranscriber();
		expect(t).toBeInstanceOf(WebSpeechTranscriber);
	});
});

describe("webSpeechBackend", () => {
	it("provides mic/tab transcribers, status, subscribe and load", () => {
		expect(webSpeechBackend.mic()).toBeInstanceOf(WebSpeechTranscriber);
		const tab = webSpeechBackend.tab();
		expect(tab.supported).toBe(false);
		const events: unknown[] = [];
		tab.start((ev) => events.push(ev));
		tab.stop();
		expect(events).toEqual([
			{ type: "error", message: "tab capture requires the whisper backend" },
		]);
		expect(webSpeechBackend.status()).toEqual({ state: "idle", device: null });
		const unsubscribe = webSpeechBackend.subscribe(() => {});
		expect(() => unsubscribe()).not.toThrow();
		expect(() => webSpeechBackend.load()).not.toThrow();
	});
});

describe("webSpeechCandidate", () => {
	it("mirrors WebSpeechTranscriber.isSupported and creates the backend", () => {
		expect(webSpeechCandidate.id).toBe("webspeech");
		expect(webSpeechCandidate.supported()).toBe(WebSpeechTranscriber.isSupported());
		expect(webSpeechCandidate.create()).toBe(webSpeechBackend);
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ktb/transcription-whisper", () => ({
	loadWhisper: vi.fn<() => void>(),
}));

import { loadWhisper } from "@ktb/transcription-whisper";
import { prefetchWhisperModel } from "./whisper-prefetch.ts";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("prefetchWhisperModel", () => {
	it("loads whisper during idle time", () => {
		const idle = vi.fn<(cb: () => void) => void>((cb) => cb());
		vi.stubGlobal("requestIdleCallback", idle);
		prefetchWhisperModel();
		expect(idle).toHaveBeenCalledOnce();
		expect(loadWhisper).toHaveBeenCalledOnce();
	});

	it("falls back to a timeout without requestIdleCallback", () => {
		vi.useFakeTimers();
		vi.stubGlobal("requestIdleCallback", undefined);
		prefetchWhisperModel();
		expect(loadWhisper).not.toHaveBeenCalled();
		vi.advanceTimersByTime(2000);
		expect(loadWhisper).toHaveBeenCalledOnce();
	});

	it("skips when the user opted into data saver", () => {
		const idle = vi.fn<(cb: () => void) => void>((cb) => cb());
		vi.stubGlobal("requestIdleCallback", idle);
		vi.stubGlobal("navigator", { connection: { saveData: true } });
		prefetchWhisperModel();
		expect(idle).not.toHaveBeenCalled();
		expect(loadWhisper).not.toHaveBeenCalled();
	});
});

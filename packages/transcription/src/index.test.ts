import { describe, expect, it, vi } from "vitest";

import {
	needsServerFallback,
	resolveTranscriptionBackend,
	type Transcriber,
	type TranscriptionBackend,
	type TranscriptionDriver,
} from "./index.ts";

const stubTranscriber: Transcriber = {
	supported: true,
	start: () => {},
	stop: () => {},
};

const stubBackend = (): TranscriptionBackend => ({
	mic: () => stubTranscriber,
	tab: () => stubTranscriber,
	status: () => ({ state: "idle", device: null }),
	subscribe: () => () => {},
	load: () => {},
});

describe("resolveTranscriptionBackend", () => {
	it("returns undefined for an empty candidate list", () => {
		expect(resolveTranscriptionBackend([])).toBeUndefined();
	});

	it("returns undefined when no candidate is supported", () => {
		const create = vi.fn(stubBackend);
		const candidates: TranscriptionDriver[] = [
			{ id: "a", supported: () => false, create },
			{ id: "b", supported: () => false, create },
		];
		expect(resolveTranscriptionBackend(candidates)).toBeUndefined();
		expect(create).not.toHaveBeenCalled();
	});

	it("picks the first supported candidate in registration order", () => {
		const backendA = stubBackend();
		const backendB = stubBackend();
		const createA = vi.fn(() => backendA);
		const createB = vi.fn(() => backendB);
		const candidates: TranscriptionDriver[] = [
			{ id: "first", supported: () => true, create: createA },
			{ id: "second", supported: () => true, create: createB },
		];
		const resolved = resolveTranscriptionBackend(candidates);
		expect(resolved).toEqual({ driverId: "first", backend: backendA });
		expect(createA).toHaveBeenCalledOnce();
		expect(createB).not.toHaveBeenCalled();
	});

	it("skips unsupported candidates ahead of a supported one", () => {
		const backend = stubBackend();
		const candidates: TranscriptionDriver[] = [
			{ id: "off", supported: () => false, create: stubBackend },
			{ id: "on", supported: () => true, create: () => backend },
		];
		expect(resolveTranscriptionBackend(candidates)).toEqual({
			driverId: "on",
			backend,
		});
	});
});

describe("needsServerFallback", () => {
	it("triggers on little transcript per voiced second", () => {
		expect(needsServerFallback({ voicedSec: 10, chars: 10 })).toBe(true);
	});

	it("does not trigger on healthy output", () => {
		expect(needsServerFallback({ voicedSec: 10, chars: 100 })).toBe(false);
	});

	it("ignores sessions below the minimum voiced duration", () => {
		expect(needsServerFallback({ voicedSec: 5, chars: 0 })).toBe(false);
	});

	it("boundary: exactly at the chars-per-second threshold", () => {
		// 6s voiced * 2.5 = 15 chars is the boundary (strict <)
		expect(needsServerFallback({ voicedSec: 6, chars: 14 })).toBe(true);
		expect(needsServerFallback({ voicedSec: 6, chars: 15 })).toBe(false);
	});
});

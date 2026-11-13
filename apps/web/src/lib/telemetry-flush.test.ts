import { describe, expect, it, vi } from "vitest";

import { makeFlushThrottler } from "./telemetry-flush.ts";

describe("makeFlushThrottler", () => {
	it("runs the first flush immediately, then throttles inside the window", async () => {
		let now = 1_000;
		const flush = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		const throttled = makeFlushThrottler({ minIntervalMs: 5_000, now: () => now });

		await throttled(flush);
		expect(flush).toHaveBeenCalledTimes(1);

		// Inside the window: skipped, resolves without flushing.
		now += 4_999;
		await throttled(flush);
		expect(flush).toHaveBeenCalledTimes(1);

		// Past the window: flushes again.
		now += 1;
		await throttled(flush);
		expect(flush).toHaveBeenCalledTimes(2);
	});

	it("coalesces concurrent callers onto one in-flight flush", async () => {
		const flush = vi
			.fn<() => Promise<void>>()
			.mockImplementation(() => new Promise<void>(() => {}));
		const throttled = makeFlushThrottler({ now: () => 0 });

		const first = throttled(flush);
		const second = throttled(flush);
		// flush runs on a microtask — let it start before asserting.
		await Promise.resolve();
		expect(flush).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it("clears the in-flight slot after completion and swallows rejections", async () => {
		let now = 0;
		const flush = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("flush boom"))
			.mockResolvedValue(undefined);
		const throttled = makeFlushThrottler({ minIntervalMs: 0, now: () => now });

		// A rejecting flush must not reject the caller (waitUntil-safe).
		await expect(throttled(flush)).resolves.toBeUndefined();
		// In-flight cleared: the next call outside the window flushes again.
		now += 1;
		await throttled(flush);
		expect(flush).toHaveBeenCalledTimes(2);
	});
});

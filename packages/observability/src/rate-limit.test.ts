import { describe, expect, it } from "vitest";

import { makeFixedWindowRateLimiter } from "./rate-limit.ts";

const limiter = (now?: () => number, maxKeys?: number) =>
	makeFixedWindowRateLimiter({ windowMs: 1_000, now, maxKeys });

describe("makeFixedWindowRateLimiter", () => {
	it("allows hits up to the limit and denies beyond it", () => {
		const rl = limiter();
		expect(rl.hit("a", 2)).toEqual({ allowed: true, retryAfterMs: 0 });
		expect(rl.hit("a", 2)).toEqual({ allowed: true, retryAfterMs: 0 });
		const denied = rl.hit("a", 2);
		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterMs).toBeGreaterThan(0);
		expect(denied.retryAfterMs).toBeLessThanOrEqual(1_000);
	});

	it("resets the window after windowMs elapses", () => {
		let at = 0;
		const rl = limiter(() => at);
		rl.hit("a", 1);
		expect(rl.hit("a", 1).allowed).toBe(false);
		at = 1_000;
		expect(rl.hit("a", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
	});

	it("isolates keys from each other", () => {
		const rl = limiter();
		rl.hit("a", 1);
		expect(rl.hit("a", 1).allowed).toBe(false);
		expect(rl.hit("b", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
	});

	it("treats non-positive or non-finite limits as unlimited and unrecorded", () => {
		const rl = limiter();
		for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(rl.hit("a", limit)).toEqual({ allowed: true, retryAfterMs: 0 });
		}
		// Unlimited hits were not recorded — a later finite limit starts fresh.
		expect(rl.hit("a", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
		expect(rl.hit("a", 1).allowed).toBe(false);
	});

	it("bounds memory: clears live windows when maxKeys is exceeded", () => {
		let at = 0;
		const rl = limiter(() => at, 2);
		rl.hit("a", 1);
		rl.hit("b", 1);
		// Third distinct key overflows the cap — map clears, all windows reset.
		expect(rl.hit("c", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
		expect(rl.hit("a", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
	});

	it("sweeps expired entries before clearing when the cap is hit", () => {
		let at = 0;
		const rl = limiter(() => at, 3);
		rl.hit("a", 1); // window ends at 1_000
		at = 500;
		rl.hit("b", 1); // window ends at 1_500
		rl.hit("c", 1); // window ends at 1_500
		at = 1_200; // 'a' expired; 'b' and 'c' still live — map is full
		expect(rl.hit("d", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
		// The sweep removed only 'a': 'b' kept its live window, so its
		// second hit is denied rather than resetting.
		expect(rl.hit("b", 1).allowed).toBe(false);
	});

	it("defaults to a 60s window when windowMs is not given", () => {
		const rl = makeFixedWindowRateLimiter();
		expect(rl.hit("a", 1)).toEqual({ allowed: true, retryAfterMs: 0 });
		const denied = rl.hit("a", 1);
		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterMs).toBeGreaterThan(0);
		expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
	});
});

/**
 * Fixed-window rate limiter — best-effort, in-memory, per-isolate.
 *
 * Workers have no durable shared memory: each isolate keeps its own
 * counters, so limits are approximate under fan-out (N isolates ≈ N×
 * the configured limit globally). That is the deliberate trade-off for
 * cheap abuse damping on high-volume anonymous endpoints like
 * /api/telemetry — Durable Objects or Cloudflare Rate Limiting rules
 * would be exact but add binding/infra surface the endpoint doesn't
 * need. State is bounded (`maxKeys`) so a spray of unique keys can't
 * grow memory without limit.
 */

export interface RateLimitDecision {
	/** Whether the hit is within the limit. */
	readonly allowed: boolean;
	/**
	 * Milliseconds until the current window resets. Only meaningful
	 * when `allowed` is false — callers map it to `Retry-After`.
	 */
	readonly retryAfterMs: number;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterMs: 0 };

export interface FixedWindowRateLimiterOptions {
	/** Window length in ms — default 60_000 (per-minute limits). */
	readonly windowMs?: number;
	/** Clock override for tests — default `Date.now`. */
	readonly now?: () => number;
	/**
	 * Max tracked keys before the map is swept/reset — default 10_000.
	 * Bounds memory against key-spraying abuse; expiry is checked lazily
	 * per key, so stale entries only leave via sweep or clear.
	 */
	readonly maxKeys?: number;
}

export interface FixedWindowRateLimiter {
	/**
	 * Record one hit for `key` and decide. `limit` is the max hits per
	 * window for this call — non-positive or non-finite means unlimited
	 * (the hit is not even recorded, so "off" costs nothing).
	 */
	hit(key: string, limit: number): RateLimitDecision;
}

interface WindowEntry {
	count: number;
	/** Epoch ms when the current window ends. */
	resetAt: number;
}

export const makeFixedWindowRateLimiter = (
	options: FixedWindowRateLimiterOptions = {},
): FixedWindowRateLimiter => {
	const windowMs = options.windowMs ?? 60_000;
	// `() => Date.now()` (not a bare `Date.now` reference) so test fake
	// timers that replace Date.now after module load still take effect.
	const now = options.now ?? (() => Date.now());
	const maxKeys = options.maxKeys ?? 10_000;
	const windows = new Map<string, WindowEntry>();

	const sweepExpired = (at: number): void => {
		for (const [key, entry] of windows) {
			if (at >= entry.resetAt) windows.delete(key);
		}
	};

	return {
		hit(key, limit) {
			if (!Number.isFinite(limit) || limit <= 0) return ALLOWED;
			const at = now();
			let entry = windows.get(key);
			if (entry === undefined || at >= entry.resetAt) {
				if (windows.size >= maxKeys) {
					sweepExpired(at);
					// Still full of live windows — key spray. Resetting all
					// windows is the bounded-memory escape hatch; it briefly
					// relaxes limits, which is acceptable for best-effort
					// edge damping (fail-open, never fail the request).
					if (windows.size >= maxKeys) windows.clear();
				}
				entry = { count: 0, resetAt: at + windowMs };
				windows.set(key, entry);
			}
			entry.count += 1;
			if (entry.count <= limit) return ALLOWED;
			return { allowed: false, retryAfterMs: Math.max(0, entry.resetAt - at) };
		},
	};
};

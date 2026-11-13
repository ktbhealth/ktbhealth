/**
 * Flush coalescing for `flushTelemetry` (M4).
 *
 * The worker entry schedules a flush via `ctx.waitUntil` after EVERY
 * fetch and queue batch. On Workers each flush can translate into
 * several OTLP export subrequests, so per-request flushing under load
 * multiplies export batches and burns the subrequest budget for
 * marginal freshness gains — the OTLP exporters already batch on their
 * own `exportInterval`.
 *
 * The throttler enforces a minimum interval between real flushes and
 * coalesces concurrent callers onto one in-flight flush. Calls inside
 * the window resolve immediately: buffered telemetry simply waits for
 * the next window (or the exporter's own interval) — bounded delay,
 * never lost data, since every flush drains the whole buffer.
 */
export interface FlushThrottlerOptions {
	/** Minimum ms between flushes — default 5_000. */
	readonly minIntervalMs?: number;
	/** Clock override for tests — default `Date.now`. */
	readonly now?: () => number;
}

export const makeFlushThrottler = (
	options: FlushThrottlerOptions = {},
): ((flush: () => Promise<void>) => Promise<void>) => {
	const minIntervalMs = options.minIntervalMs ?? 5_000;
	const now = options.now ?? (() => Date.now());
	let lastFlushAt = Number.NEGATIVE_INFINITY;
	let inflight: Promise<void> | null = null;

	return (flush) => {
		// Concurrent callers share the in-flight flush.
		if (inflight !== null) return inflight;
		if (now() - lastFlushAt < minIntervalMs) return Promise.resolve();
		lastFlushAt = now();
		inflight = Promise.resolve()
			.then(flush)
			// Flush contract is "never rejects"; keep it even if an
			// implementation regresses — a rejected waitUntil promise is
			// pure noise.
			.catch(() => undefined)
			.finally(() => {
				inflight = null;
			});
		return inflight;
	};
};

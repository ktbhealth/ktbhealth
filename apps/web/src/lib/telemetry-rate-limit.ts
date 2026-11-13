import { env } from "cloudflare:workers";

import {
	makeFixedWindowRateLimiter,
	telemetryConfigFromEnv,
	type ObservabilityEnv,
	type RateLimitDecision,
} from "@ktb/observability";

/**
 * /api/telemetry ingest rate limiting — the edge wiring around the
 * port's fixed-window limiter.
 *
 * Limits come from `telemetryConfigFromEnv(env)` (KTB_TELEMETRY_RATE_
 * LIMIT_*), re-resolved per request so binding changes and tests take
 * effect without a redeploy of module state. The limiter maps are
 * module-level: they live for the isolate's lifetime, which is exactly
 * the best-effort semantics documented on `makeFixedWindowRateLimiter`
 * (per-isolate counters, approximate under fan-out — deliberate vs.
 * Durable Objects for a write-only telemetry sink).
 *
 * Fail-open by contract: telemetry is best-effort, so any unexpected
 * error in config resolution or the limiter itself allows the request
 * through rather than risking app breakage. Over-limit requests are
 * still shed with 429 by the route — that path is the limiter working,
 * not failing.
 */

const WINDOW_MS = 60_000;

const perIpLimiter = makeFixedWindowRateLimiter({ windowMs: WINDOW_MS });
const globalLimiter = makeFixedWindowRateLimiter({ windowMs: WINDOW_MS });

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterMs: 0 };

/**
 * Client identity for rate limiting: Cloudflare's `cf-connecting-ip`
 * (unspoofable on the edge — CF overwrites it). Absent outside
 * workerd (dev:node, tests) all such traffic shares the "unknown"
 * bucket, which is the safe direction: local/dev bursts are bounded
 * too rather than silently unlimited.
 */
export const telemetryClientKey = (request: Request): string =>
	request.headers.get("cf-connecting-ip")?.trim() || "unknown";

/**
 * Check the request against the per-IP and global ingest limits.
 * Never throws — see the fail-open contract above.
 */
export const checkTelemetryIngestRateLimit = (request: Request): RateLimitDecision => {
	try {
		const { rateLimit } = telemetryConfigFromEnv(
			env as unknown as ObservabilityEnv,
		).clientTelemetry;
		const perIp = perIpLimiter.hit(telemetryClientKey(request), rateLimit.perIpPerMinute);
		if (!perIp.allowed) return perIp;
		return globalLimiter.hit("global", rateLimit.globalPerMinute);
	} catch {
		return ALLOWED;
	}
};

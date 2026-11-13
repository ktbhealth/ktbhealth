import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "cloudflare:workers";

import { checkTelemetryIngestRateLimit, telemetryClientKey } from "./telemetry-rate-limit.ts";

const post = (ip?: string) =>
	new Request("http://localhost/api/telemetry", {
		method: "POST",
		headers: ip === undefined ? {} : { "cf-connecting-ip": ip },
		body: "{}",
	});

const envBag = env as unknown as Record<string, unknown>;

afterEach(() => {
	vi.useRealTimers();
	delete envBag.KTB_TELEMETRY_RATE_LIMIT_PER_IP;
	delete envBag.KTB_TELEMETRY_RATE_LIMIT_GLOBAL;
});

describe("telemetryClientKey", () => {
	it("reads cf-connecting-ip and falls back to 'unknown'", () => {
		expect(telemetryClientKey(post("1.2.3.4"))).toBe("1.2.3.4");
		expect(telemetryClientKey(post())).toBe("unknown");
		expect(telemetryClientKey(post("  "))).toBe("unknown");
	});
});

describe("checkTelemetryIngestRateLimit", () => {
	it("allows under the default limits", () => {
		for (let i = 0; i < 5; i++) {
			expect(checkTelemetryIngestRateLimit(post("10.0.0.1")).allowed).toBe(true);
		}
	});

	it("denies per-IP over the configured limit with retryAfterMs", () => {
		envBag.KTB_TELEMETRY_RATE_LIMIT_PER_IP = "2";
		envBag.KTB_TELEMETRY_RATE_LIMIT_GLOBAL = "100";
		const req = post("10.0.0.2");
		expect(checkTelemetryIngestRateLimit(req).allowed).toBe(true);
		expect(checkTelemetryIngestRateLimit(req).allowed).toBe(true);
		const denied = checkTelemetryIngestRateLimit(req);
		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterMs).toBeGreaterThan(0);
	});

	it("isolates the limit per client IP", () => {
		envBag.KTB_TELEMETRY_RATE_LIMIT_PER_IP = "1";
		envBag.KTB_TELEMETRY_RATE_LIMIT_GLOBAL = "100";
		checkTelemetryIngestRateLimit(post("10.0.0.3"));
		expect(checkTelemetryIngestRateLimit(post("10.0.0.3")).allowed).toBe(false);
		expect(checkTelemetryIngestRateLimit(post("10.0.0.4")).allowed).toBe(true);
	});

	it("applies the global ceiling across distinct IPs", () => {
		// Jump past every live window — earlier tests already consumed
		// global hits in the current window.
		const later = Date.now() + 120_000;
		vi.useFakeTimers();
		vi.setSystemTime(later);
		envBag.KTB_TELEMETRY_RATE_LIMIT_PER_IP = "100";
		envBag.KTB_TELEMETRY_RATE_LIMIT_GLOBAL = "1";
		expect(checkTelemetryIngestRateLimit(post("10.0.1.1")).allowed).toBe(true);
		// Different IP, same global bucket — denied.
		expect(checkTelemetryIngestRateLimit(post("10.0.1.2")).allowed).toBe(false);
	});

	it("resets the window after a minute", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		envBag.KTB_TELEMETRY_RATE_LIMIT_PER_IP = "1";
		envBag.KTB_TELEMETRY_RATE_LIMIT_GLOBAL = "100";
		const req = post("10.0.0.5");
		expect(checkTelemetryIngestRateLimit(req).allowed).toBe(true);
		expect(checkTelemetryIngestRateLimit(req).allowed).toBe(false);
		vi.setSystemTime(1_000_000 + 61_000);
		expect(checkTelemetryIngestRateLimit(req).allowed).toBe(true);
	});

	it("treats 0 as disabled", () => {
		envBag.KTB_TELEMETRY_RATE_LIMIT_PER_IP = "0";
		envBag.KTB_TELEMETRY_RATE_LIMIT_GLOBAL = "0";
		for (let i = 0; i < 10; i++) {
			expect(checkTelemetryIngestRateLimit(post("10.0.0.6")).allowed).toBe(true);
		}
	});

	it("fails open when config resolution throws", () => {
		// A throwing env getter simulates a corrupted binding read —
		// telemetry is best-effort, so the request must be allowed.
		Object.defineProperty(envBag, "KTB_TELEMETRY_RATE_LIMIT_PER_IP", {
			configurable: true,
			get() {
				throw new Error("binding exploded");
			},
		});
		expect(checkTelemetryIngestRateLimit(post("10.0.0.7"))).toEqual({
			allowed: true,
			retryAfterMs: 0,
		});
	});
});

import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Metric from "effect/Metric";
import { HttpClient, HttpClientResponse } from "effect/http";
import { OtlpExporter } from "effect/observability";
import * as Tracer from "effect/Tracer";

import { telemetryConfigFromEnv, Telemetry } from "@ktb/observability";

import { makeOtlpLayers, otlpTelemetryDriver, TelemetryOtlpLive } from "./index.ts";

const ENDPOINT = "http://otel-collector.test:4318";

/** Env exercising every signal through the base endpoint. */
const fullEnv = {
	OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
	OTEL_SERVICE_NAME: "ktb-test",
	KTB_ENVIRONMENT: "test",
};

describe("otlpTelemetryDriver", () => {
	it("has the telemetry-otlp id and targets the Telemetry port", () => {
		expect(otlpTelemetryDriver.id).toBe("telemetry-otlp");
		expect(otlpTelemetryDriver.port).toBe(Telemetry.key);
	});

	it("is ineligible without any OTLP endpoint", () => {
		expect(otlpTelemetryDriver.when?.({})).toBe(false);
	});

	it("is eligible when the base endpoint resolves all signals", () => {
		expect(otlpTelemetryDriver.when?.(fullEnv)).toBe(true);
	});

	it("is eligible with a single per-signal endpoint", () => {
		expect(
			otlpTelemetryDriver.when?.({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${ENDPOINT}/v1/traces` }),
		).toBe(true);
	});

	it("is ineligible when OTEL_SDK_DISABLED is set", () => {
		expect(otlpTelemetryDriver.when?.({ ...fullEnv, OTEL_SDK_DISABLED: "true" })).toBe(false);
		expect(otlpTelemetryDriver.when?.({ ...fullEnv, OTEL_SDK_DISABLED: "1" })).toBe(false);
	});

	it("provides a layer", () => {
		const layer = otlpTelemetryDriver.provides(fullEnv);
		expect(Layer.isLayer(layer)).toBe(true);
	});
});

interface CapturedRequest {
	readonly url: string;
	readonly body: string;
}

/** HttpClient stub that records requests and answers 200 — keeps tests
 * hermetic (no fetch, no collector). */
const makeStubHttp = () => {
	const requests: CapturedRequest[] = [];
	const client = HttpClient.make((request, url) => {
		const body = request.body;
		const text =
			body._tag === "Uint8Array"
				? (body.text ?? new TextDecoder().decode(body.body))
				: body._tag === "Raw"
					? String(body.body)
					: "";
		requests.push({ url: url.toString(), body: text });
		return Effect.succeed(
			HttpClientResponse.fromWeb(
				request,
				new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
			),
		);
	});
	return { requests, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

const testMetric = Metric.counter("ktb_test_otlp_exports_total");

const flushAll = Effect.gen(function* () {
	const flusher = yield* OtlpExporter.Flusher;
	yield* flusher.flush;
});

describe("makeOtlpLayers", () => {
	it("exports logs, traces and metrics to their OTLP endpoints", async () => {
		const config = telemetryConfigFromEnv(fullEnv);
		const stub = makeStubHttp();
		const runtime = ManagedRuntime.make(makeOtlpLayers(config, stub.layer));
		try {
			await runtime.runPromise(
				Effect.gen(function* () {
					yield* Effect.logInfo("otlp smoke");
					yield* Effect.withSpan(Effect.void, "otlp-test-span");
					yield* Metric.update(testMetric, 1);
					yield* flushAll;
				}),
			);
			const urls = stub.requests.map((r) => r.url);
			expect(urls).toContain(`${ENDPOINT}/v1/logs`);
			expect(urls).toContain(`${ENDPOINT}/v1/traces`);
			expect(urls).toContain(`${ENDPOINT}/v1/metrics`);

			const logs = stub.requests.find((r) => r.url.endsWith("/v1/logs"));
			expect(logs?.body).toContain("resourceLogs");
			expect(logs?.body).toContain("ktb-test");

			const traces = stub.requests.find((r) => r.url.endsWith("/v1/traces"));
			expect(traces?.body).toContain("resourceSpans");
			expect(traces?.body).toContain("otlp-test-span");

			const metrics = stub.requests.find((r) => r.url.endsWith("/v1/metrics"));
			expect(metrics?.body).toContain("resourceMetrics");
			expect(metrics?.body).toContain("ktb_test_otlp_exports_total");
		} finally {
			await runtime.dispose();
		}
	});

	it("only exports the signals with configured endpoints", async () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${ENDPOINT}/v1/logs`,
		});
		const stub = makeStubHttp();
		const runtime = ManagedRuntime.make(makeOtlpLayers(config, stub.layer));
		try {
			await runtime.runPromise(
				Effect.gen(function* () {
					yield* Effect.logInfo("logs only");
					yield* Effect.withSpan(Effect.void, "should-not-export");
					yield* Metric.update(testMetric, 1);
					yield* flushAll;
				}),
			);
			const urls = stub.requests.map((r) => r.url);
			expect(urls).toContain(`${ENDPOINT}/v1/logs`);
			expect(urls.some((u) => u.endsWith("/v1/traces"))).toBe(false);
			expect(urls.some((u) => u.endsWith("/v1/metrics"))).toBe(false);
		} finally {
			await runtime.dispose();
		}
	});

	it("keeps the native tracer when no traces endpoint is set", async () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${ENDPOINT}/v1/logs`,
		});
		const stub = makeStubHttp();
		const runtime = ManagedRuntime.make(makeOtlpLayers(config, stub.layer));
		try {
			const tracer = await runtime.runPromise(Effect.service(Tracer.Tracer));
			// Reference default is the native in-memory tracer — the OTLP
			// tracer must not replace it without a traces endpoint.
			expect(tracer).toBe(Tracer.nativeTracer);
		} finally {
			await runtime.dispose();
		}
	});

	it("reports per-signal health on the Telemetry service", async () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${ENDPOINT}/v1/logs`,
		});
		const stub = makeStubHttp();
		const runtime = ManagedRuntime.make(makeOtlpLayers(config, stub.layer));
		try {
			const health = await runtime.runPromise(
				Effect.gen(function* () {
					const t = yield* Telemetry;
					return yield* t.health;
				}),
			);
			// Only logs resolved: traces stay off, metrics stay on the
			// Prometheus pull path.
			expect(health).toEqual({ logs: "otlp", traces: "off", metrics: "prometheus" });
		} finally {
			await runtime.dispose();
		}
	});

	it("degrades flush to a no-op when the SDK is disabled", async () => {
		const config = telemetryConfigFromEnv({ ...fullEnv, OTEL_SDK_DISABLED: "true" });
		const stub = makeStubHttp();
		const runtime = ManagedRuntime.make(makeOtlpLayers(config, stub.layer));
		try {
			await runtime.runPromise(
				Effect.gen(function* () {
					yield* Effect.logInfo("disabled sdk");
					const t = yield* Telemetry;
					yield* t.flush;
				}),
			);
			expect(stub.requests).toHaveLength(0);
		} finally {
			await runtime.dispose();
		}
	});
});

describe("TelemetryOtlpLive via driver provides", () => {
	it("composes through the driver's provides() with fetch transport", async () => {
		// Smoke only — never actually fetches because nothing is logged
		// and flush drains an empty registry. The tiny shutdown timeout
		// keeps dispose fast: the metrics exporter still attempts one
		// export of the (empty) registry against the unreachable host.
		const layer = otlpTelemetryDriver.provides({
			...fullEnv,
			KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS: "100",
		});
		const runtime = ManagedRuntime.make(layer as Layer.Layer<unknown, unknown, never>);
		try {
			const health = await runtime.runPromise(
				Effect.gen(function* () {
					const t = yield* Telemetry;
					return yield* t.health;
				}),
			);
			expect(health).toEqual({ logs: "otlp", traces: "otlp", metrics: "otlp" });
		} finally {
			await runtime.dispose();
		}
	});
});

describe("TelemetryOtlpLive", () => {
	it("provides a working Telemetry service for a disabled config", async () => {
		const config = telemetryConfigFromEnv({ OTEL_SDK_DISABLED: "1" });
		const runtime = ManagedRuntime.make(TelemetryOtlpLive(config));
		try {
			const health = await runtime.runPromise(
				Effect.gen(function* () {
					const t = yield* Telemetry;
					yield* t.flush;
					return yield* t.health;
				}),
			);
			expect(health.metrics).toBeDefined();
		} finally {
			await runtime.dispose();
		}
	});
});

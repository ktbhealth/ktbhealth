import { describe, expect, it } from "vitest";

import {
	OBSERVABILITY_ENV_KEYS,
	parseKeyValueList,
	parseLogLevel,
	telemetryConfigFromEnv,
	type ObservabilityEnv,
} from "./config.ts";

describe("OBSERVABILITY_ENV_KEYS", () => {
	it("lists every ObservabilityEnv key exactly once", () => {
		// Compile-time exhaustiveness lives in config.ts
		// (_envKeysExhaustive); this pins the runtime list so a refactor
		// that drops a key fails loudly instead of silently.
		expect([...OBSERVABILITY_ENV_KEYS].sort()).toEqual(
			[
				"KTB_ENVIRONMENT",
				"KTB_LOG_LEVEL",
				"KTB_TELEMETRY_CLIENT",
				"KTB_TELEMETRY_CLIENT_SAMPLE_RATE",
				"KTB_TELEMETRY_EXPORT_INTERVAL_MS",
				"KTB_TELEMETRY_MAX_BATCH_SIZE",
				"KTB_TELEMETRY_RATE_LIMIT_GLOBAL",
				"KTB_TELEMETRY_RATE_LIMIT_PER_IP",
				"KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS",
				"KTB_TELEMETRY_TRACES_SAMPLE_RATE",
				"OTEL_EXPORTER_OTLP_COMPRESSION",
				"OTEL_EXPORTER_OTLP_ENDPOINT",
				"OTEL_EXPORTER_OTLP_HEADERS",
				"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
				"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
				"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
				"OTEL_RESOURCE_ATTRIBUTES",
				"OTEL_SDK_DISABLED",
				"OTEL_SERVICE_NAME",
			].sort(),
		);
		expect(new Set(OBSERVABILITY_ENV_KEYS).size).toBe(OBSERVABILITY_ENV_KEYS.length);
	});

	it("every listed key is readable by telemetryConfigFromEnv", () => {
		// Feed each key a sentinel value through a cast env object —
		// proves the list and the parser stay aligned.
		const env = Object.fromEntries(
			OBSERVABILITY_ENV_KEYS.map((key) => [key, "1"]),
		) as ObservabilityEnv;
		const config = telemetryConfigFromEnv(env);
		expect(config.disabled).toBe(true);
		expect(config.serviceName).toBe("1");
		// "1" clamps up to each parser's minimum.
		expect(config.otlp.exportIntervalMs).toBe(100);
		expect(config.otlp.maxBatchSize).toBe(1);
		expect(config.otlp.shutdownTimeoutMs).toBe(100);
		expect(config.tracesSampleRate).toBe(1);
		expect(config.clientTelemetry.sampleRate).toBe(1);
	});
});

describe("parseKeyValueList", () => {
	it("returns empty object for undefined/empty", () => {
		expect(parseKeyValueList(undefined)).toEqual({});
		expect(parseKeyValueList("")).toEqual({});
	});

	it("parses comma-separated pairs and percent-decodes values", () => {
		expect(parseKeyValueList("a=1,b=two%20words,c=")).toEqual({
			a: "1",
			b: "two words",
			c: "",
		});
	});

	it("skips malformed pairs", () => {
		expect(parseKeyValueList("noequals,=nokey,  =blank,a=b")).toEqual({ a: "b" });
	});

	it("keeps raw value when percent-decoding fails", () => {
		expect(parseKeyValueList("k=%E0%A4%A")).toEqual({ k: "%E0%A4%A" });
	});
});

describe("parseLogLevel", () => {
	it("accepts canonical levels case-insensitively", () => {
		expect(parseLogLevel("debug")).toBe("Debug");
		expect(parseLogLevel("INFO")).toBe("Info");
		expect(parseLogLevel("warning")).toBe("Warning");
		expect(parseLogLevel("none")).toBe("None");
	});

	it("maps common aliases", () => {
		expect(parseLogLevel("warn")).toBe("Warning");
		expect(parseLogLevel("err")).toBe("Error");
		expect(parseLogLevel("dbg")).toBe("Debug");
	});

	it("rejects unknown and missing values", () => {
		expect(parseLogLevel("verbose")).toBeUndefined();
		expect(parseLogLevel(undefined)).toBeUndefined();
		expect(parseLogLevel("")).toBeUndefined();
	});
});

describe("telemetryConfigFromEnv", () => {
	it("defaults to local DX: no OTLP, everything off", () => {
		const config = telemetryConfigFromEnv({});
		expect(config.disabled).toBe(false);
		expect(config.serviceName).toBe("ktb");
		expect(config.environment).toBe("development");
		expect(config.otlp.endpoints).toEqual({});
		expect(config.tracesSampleRate).toBe(1);
		expect(config.clientTelemetry).toEqual({
			enabled: true,
			sampleRate: 1,
			rateLimit: { perIpPerMinute: 120, globalPerMinute: 6_000 },
		});
	});

	it("expands a base OTLP endpoint into per-signal /v1/<signal> URLs", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
		});
		expect(config.otlp.endpoints).toEqual({
			logs: "https://otel.example.com/v1/logs",
			traces: "https://otel.example.com/v1/traces",
			metrics: "https://otel.example.com/v1/metrics",
		});
	});

	it("handles trailing slashes and per-signal overrides", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector:4318/",
			OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://jaeger:4318/v1/traces",
			OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://logs.only/v1/logs",
		});
		expect(config.otlp.endpoints.logs).toBe("https://logs.only/v1/logs");
		expect(config.otlp.endpoints.traces).toBe("https://jaeger:4318/v1/traces");
		expect(config.otlp.endpoints.metrics).toBe("https://collector:4318/v1/metrics");
	});

	it("treats blank per-signal endpoints as unset", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
			OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "   ",
		});
		expect(config.otlp.endpoints.logs).toBe("https://otel.example.com/v1/logs");
	});

	it("reads service name/version/environment from dedicated vars and resource attributes", () => {
		const byEnv = telemetryConfigFromEnv({
			OTEL_SERVICE_NAME: "ktb-api",
			KTB_ENVIRONMENT: "staging",
		});
		expect(byEnv.serviceName).toBe("ktb-api");
		expect(byEnv.environment).toBe("staging");

		const byAttrs = telemetryConfigFromEnv({
			OTEL_RESOURCE_ATTRIBUTES:
				"service.name=from-attrs,service.version=1.2.3,deployment.environment=prod,team=health",
		});
		expect(byAttrs.serviceName).toBe("from-attrs");
		expect(byAttrs.serviceVersion).toBe("1.2.3");
		expect(byAttrs.environment).toBe("prod");
		expect(byAttrs.resourceAttributes).toEqual({
			"service.name": "from-attrs",
			"service.version": "1.2.3",
			"deployment.environment": "prod",
			team: "health",
		});
	});

	it("parses OTLP headers and compression", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic%20abc,x-tenant=1",
			OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
		});
		expect(config.otlp.headers).toEqual({ Authorization: "Basic abc", "x-tenant": "1" });
		expect(config.otlp.compression).toBe("gzip");
		expect(
			telemetryConfigFromEnv({ OTEL_EXPORTER_OTLP_COMPRESSION: "GZIP" }).otlp.compression,
		).toBe("gzip");
		expect(telemetryConfigFromEnv({}).otlp.compression).toBe("none");
	});

	it("honors OTEL_SDK_DISABLED and numeric tuning vars", () => {
		const config = telemetryConfigFromEnv({
			OTEL_SDK_DISABLED: "true",
			KTB_TELEMETRY_TRACES_SAMPLE_RATE: "0.25",
			KTB_TELEMETRY_EXPORT_INTERVAL_MS: "5000",
			KTB_TELEMETRY_MAX_BATCH_SIZE: "128",
			KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS: "1500",
			KTB_TELEMETRY_CLIENT: "0",
			KTB_TELEMETRY_CLIENT_SAMPLE_RATE: "0.5",
			KTB_LOG_LEVEL: "debug",
		} satisfies ObservabilityEnv);
		expect(config.disabled).toBe(true);
		expect(config.tracesSampleRate).toBe(0.25);
		expect(config.otlp.exportIntervalMs).toBe(5_000);
		expect(config.otlp.maxBatchSize).toBe(128);
		expect(config.otlp.shutdownTimeoutMs).toBe(1_500);
		expect(config.clientTelemetry).toEqual({
			enabled: false,
			sampleRate: 0.5,
			rateLimit: { perIpPerMinute: 120, globalPerMinute: 6_000 },
		});
		expect(config.logLevel).toBe("Debug");
	});

	it("parses client telemetry rate limits, 0 disables", () => {
		const config = telemetryConfigFromEnv({
			KTB_TELEMETRY_RATE_LIMIT_PER_IP: "30",
			KTB_TELEMETRY_RATE_LIMIT_GLOBAL: "0",
		});
		expect(config.clientTelemetry.rateLimit).toEqual({
			perIpPerMinute: 30,
			globalPerMinute: 0,
		});
	});

	it("clamps out-of-range numerics to safe bounds", () => {
		const config = telemetryConfigFromEnv({
			KTB_TELEMETRY_TRACES_SAMPLE_RATE: "4",
			KTB_TELEMETRY_CLIENT_SAMPLE_RATE: "-1",
			KTB_TELEMETRY_EXPORT_INTERVAL_MS: "1",
			KTB_TELEMETRY_MAX_BATCH_SIZE: "999999",
			KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS: "0",
		});
		expect(config.tracesSampleRate).toBe(1);
		expect(config.clientTelemetry.sampleRate).toBe(0);
		expect(config.otlp.exportIntervalMs).toBe(100);
		expect(config.otlp.maxBatchSize).toBe(4096);
		expect(config.otlp.shutdownTimeoutMs).toBe(100);
	});

	it("falls back on non-numeric values", () => {
		const config = telemetryConfigFromEnv({
			KTB_TELEMETRY_TRACES_SAMPLE_RATE: "lots",
			KTB_TELEMETRY_EXPORT_INTERVAL_MS: "soon",
		});
		expect(config.tracesSampleRate).toBe(1);
		expect(config.otlp.exportIntervalMs).toBe(10_000);
	});
});

describe("OTLP endpoint transport guard", () => {
	it("rejects plain http endpoints on non-local hosts", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel.example.com",
		});
		expect(config.otlp.endpoints).toEqual({});
		expect(config.warnings).toHaveLength(3);
		expect(config.warnings?.[0]).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
		expect(config.warnings?.[0]).toContain("otel.example.com");
		expect(config.warnings?.[0]).toContain('signal "logs"');
	});

	it("keeps https endpoints untouched with no warnings", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
		});
		expect(config.otlp.endpoints.logs).toBe("https://otel.example.com/v1/logs");
		expect(config.warnings).toEqual([]);
	});

	it("allows http to local collectors", () => {
		for (const endpoint of [
			"http://localhost:4318",
			"http://127.0.0.1:4318",
			"http://127.10.0.2:4318",
			"http://[::1]:4318",
			"http://otel.local:4318",
			"http://collector.localhost:4318",
			"http://0.0.0.0:4318",
			"http://10.0.0.5:4318",
			"http://172.18.0.2:4318",
			"http://192.168.1.10:4318",
			"http://169.254.1.1:4318",
		]) {
			const config = telemetryConfigFromEnv({
				OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
			});
			expect(config.otlp.endpoints.logs, endpoint).toBe(`${endpoint}/v1/logs`);
			expect(config.warnings, endpoint).toEqual([]);
		}
	});

	it("rejects http on public and edge-case hosts", () => {
		for (const endpoint of [
			"http://otel.example.com:4318",
			"http://8.8.8.8:4318",
			"http://172.15.0.1:4318", // just outside 172.16/12
			"http://172.32.0.1:4318",
			"http://collector.internal:4318",
			"http://example.local.evil.com:4318",
		]) {
			const config = telemetryConfigFromEnv({
				OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
			});
			expect(config.otlp.endpoints, endpoint).toEqual({});
			expect(config.warnings, endpoint).toHaveLength(3);
		}
	});

	it("validates each per-signal override independently", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
			OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://traces.example.com/v1/traces",
			OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://localhost:4318/v1/metrics",
		});
		// Insecure per-signal override rejects that signal outright — no
		// fallback to the https base endpoint.
		expect(config.otlp.endpoints.traces).toBeUndefined();
		expect(config.otlp.endpoints.metrics).toBe("http://localhost:4318/v1/metrics");
		expect(config.otlp.endpoints.logs).toBe("https://collector.example.com/v1/logs");
		expect(config.warnings).toHaveLength(1);
		expect(config.warnings?.[0]).toContain("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
	});

	it("names the base var when a derived endpoint is dropped", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel.example.com",
			OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.example.com/v1/traces",
		});
		expect(config.otlp.endpoints.traces).toBe("https://traces.example.com/v1/traces");
		expect(config.otlp.endpoints.logs).toBeUndefined();
		expect(config.otlp.endpoints.metrics).toBeUndefined();
		expect(config.warnings).toHaveLength(2);
		expect(config.warnings?.every((w) => w.includes("OTEL_EXPORTER_OTLP_ENDPOINT"))).toBe(true);
	});

	it("leaves endpoints and warnings untouched when the SDK is disabled", () => {
		const config = telemetryConfigFromEnv({
			OTEL_SDK_DISABLED: "true",
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel.example.com",
		});
		expect(config.otlp.endpoints.logs).toBe("http://otel.example.com/v1/logs");
		expect(config.warnings).toEqual([]);
	});

	it("passes through unparseable endpoints unchanged", () => {
		const config = telemetryConfigFromEnv({
			OTEL_EXPORTER_OTLP_ENDPOINT: "not a url",
		});
		expect(config.otlp.endpoints.logs).toBe("not a url/v1/logs");
		expect(config.warnings).toEqual([]);
	});
});

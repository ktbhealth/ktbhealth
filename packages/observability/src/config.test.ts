import { describe, expect, it } from "vitest";

import {
	parseKeyValueList,
	parseLogLevel,
	telemetryConfigFromEnv,
	type ObservabilityEnv,
} from "./config.ts";

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
		expect(config.clientTelemetry).toEqual({ enabled: true, sampleRate: 1 });
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
		expect(config.clientTelemetry).toEqual({ enabled: false, sampleRate: 0.5 });
		expect(config.logLevel).toBe("Debug");
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

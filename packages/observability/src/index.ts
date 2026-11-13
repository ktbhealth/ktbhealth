import type { Driver } from "@ktb/driver-framework";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import type { LogLevel } from "effect/LogLevel";

import { telemetryConfigFromEnv, type ObservabilityEnv, type TelemetryConfig } from "./config.ts";
import { Telemetry, TelemetryLocalLive } from "./service.ts";
import { consoleJsonLogger } from "./redact.ts";

export * from "./config.ts";
export * from "./context.ts";
export * from "./ingest.ts";
export * from "./metrics.ts";
export * from "./rate-limit.ts";
export * from "./redact.ts";
export * from "./sampler.ts";
export * from "./service.ts";

/**
 * Observability port package — provider-agnostic telemetry primitives:
 * config resolution, request context, log redaction, metric definitions,
 * the `Telemetry` service and driver descriptors. Signal exporters live
 * in sibling adapter packages (`@ktb/observability-otlp`); this package
 * ships the always-eligible console driver so every runtime has
 * structured logs + Prometheus scrape out of the box.
 */

/**
 * Layer honoring `KTB_LOG_LEVEL` — provides `References.MinimumLogLevel`
 * when configured. Shared by every telemetry driver (the level applies
 * regardless of which exporter wins).
 */
export const logLevelLayer = (config: TelemetryConfig) =>
	config.logLevel === undefined
		? Layer.empty
		: Layer.succeed(References.MinimumLogLevel, config.logLevel as LogLevel);

/**
 * Surface config warnings on the log channel at layer build — e.g. an
 * insecure remote `http://` OTLP endpoint dropped during resolution.
 * Both telemetry drivers merge this layer so the reason is logged
 * whichever exporter wins; warnings never carry header values or full
 * URLs (see `guardOtlpEndpoints`).
 */
export const telemetryWarningsLayer = (config: TelemetryConfig) => {
	const warnings = config.warnings ?? [];
	return warnings.length === 0
		? Layer.empty
		: Layer.effectDiscard(Effect.forEach(warnings, (warning) => Effect.logWarning(warning)));
};

/**
 * Console driver — the local/DX default and the always-eligible fallback:
 * single-line JSON logs (redacted) + span-event logger + Prometheus
 * scrape via `Telemetry.scrape()`. No OTLP, no network, zero config.
 * Ordered LAST in the driver list; any exporter driver that is eligible
 * wins instead.
 */
export const telemetryConsoleDriver: Driver<ObservabilityEnv> = {
	id: "telemetry-console",
	port: Telemetry.key,
	provides: (env) => {
		const config = telemetryConfigFromEnv(env);
		return Layer.mergeAll(
			Logger.layer([consoleJsonLogger, Logger.tracerLogger]),
			TelemetryLocalLive(config),
			logLevelLayer(config),
			telemetryWarningsLayer(config),
		);
	},
};

import type { Driver } from "@ktb/driver-framework";
import {
	consoleJsonLogger,
	ingestClientEvents,
	logLevelLayer,
	sampledTracer,
	telemetryConfigFromEnv,
	telemetryWarningsLayer,
	Telemetry,
	type ObservabilityEnv,
	type TelemetryConfig,
	type TelemetryHealth,
	type TelemetryShape,
} from "@ktb/observability";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import {
	OtlpExporter,
	OtlpLogger,
	OtlpMetrics,
	OtlpSerialization,
	OtlpTracer,
	PrometheusMetrics,
} from "effect/observability";
import * as Tracer from "effect/Tracer";

/**
 * OTLP telemetry adapter — the network edge of the observability port.
 *
 * `@ktb/observability` stays provider-agnostic; this package binds the
 * port to Effect's built-in OTLP exporters (`effect/observability`),
 * which speak OTLP/HTTP+JSON to any collector (Grafana LGTM, Jaeger,
 * Honeycomb, vendor endpoints). Transport is `FetchHttpClient` — global
 * `fetch` only, so the same code runs on workerd, bun, node and
 * browsers with no platform imports.
 *
 * Composition notes:
 * - All three signal exporters share ONE `OtlpExporter.layerFlusher`
 *   (a module-level constant in effect — layer memoization keys on the
 *   instance, so every reference resolves to the same registry). One
 *   `Telemetry.flush()` therefore drains logs + traces + metrics.
 * - The logger set is built explicitly (`consoleJsonLogger` +
 *   `tracerLogger` + OTLP) instead of `OtlpLogger.layer`'s
 *   merge-with-existing default, which would duplicate records already
 *   emitted by sibling loggers.
 * - `OtlpSerialization.layerJson` + the caller-supplied `HttpClient`
 *   layer are provided with `Layer.provide` (consumed, not re-exported)
 *   so this layer doesn't leak transport services into the app context.
 *   `Flusher` IS re-exported (`provideMerge`) — it is the documented
 *   manual-drain handle and matches the `Otlp*` layer conventions.
 */

/** True when the config warrants OTLP exporters: at least one signal
 * endpoint resolved AND the SDK isn't disabled. */
const otlpActive = (config: TelemetryConfig): boolean =>
	!config.disabled &&
	(config.otlp.endpoints.logs !== undefined ||
		config.otlp.endpoints.traces !== undefined ||
		config.otlp.endpoints.metrics !== undefined);

/** Options shared by every signal exporter — resource identity plus
 * the batching/shutdown knobs resolved once from env. */
const signalBase = (config: TelemetryConfig) => ({
	resource: {
		serviceName: config.serviceName,
		serviceVersion: config.serviceVersion,
		attributes: {
			...config.resourceAttributes,
			"deployment.environment": config.environment,
		},
	},
	headers: config.otlp.headers,
	compression: config.otlp.compression,
	exportInterval: Duration.millis(config.otlp.exportIntervalMs),
	shutdownTimeout: Duration.millis(config.otlp.shutdownTimeoutMs),
});

/**
 * Telemetry service backed by the shared OTLP flusher. `flush` is a
 * bounded drain (`shutdownTimeoutMs` cap — never hangs the request or
 * worker lifecycle); when the SDK is disabled or no endpoint resolved
 * it degrades to `Effect.void` so the port contract holds even if this
 * layer is composed defensively outside the driver predicate.
 * `scrape` stays Prometheus pull — orthogonal to OTLP push.
 */
export const makeOtlpTelemetryLayer = (config: TelemetryConfig) => {
	const active = otlpActive(config);
	const { endpoints } = config.otlp;
	const health: TelemetryHealth = {
		logs: active && endpoints.logs !== undefined ? "otlp" : "console",
		traces: active && endpoints.traces !== undefined ? "otlp" : "off",
		metrics: active && endpoints.metrics !== undefined ? "otlp" : "prometheus",
	};
	return Layer.effect(
		Telemetry,
		Effect.gen(function* () {
			const flusher = yield* OtlpExporter.Flusher;
			return {
				flush: active
					? flusher.flush.pipe(
							Effect.timeoutOption(Duration.millis(config.otlp.shutdownTimeoutMs)),
							Effect.asVoid,
						)
					: Effect.void,
				scrape: PrometheusMetrics.format(),
				ingest: ingestClientEvents(config),
				health: Effect.succeed(health),
			} satisfies TelemetryShape;
		}),
	).pipe(Layer.provideMerge(OtlpExporter.layerFlusher));
};

/** Live Telemetry layer for OTLP-backed deployments (tests, manual
 * composition). Mirrors `TelemetryLocalLive` in the port package. */
export const TelemetryOtlpLive = (config: TelemetryConfig) => makeOtlpTelemetryLayer(config);

/**
 * Build the full OTLP layer set for a resolved config. `httpClientLayer`
 * is injected so tests can substitute a stub transport — the driver
 * passes `FetchHttpClient.layer`, tests pass a capturing client.
 *
 * Returned layer provides: `CurrentLoggers`, `Tracer.Tracer` (only when
 * a traces endpoint is set), `Telemetry`, `OtlpExporter.Flusher` and
 * `References.MinimumLogLevel` (when KTB_LOG_LEVEL is set). Requires
 * nothing beyond what `httpClientLayer` itself needs.
 */
export const makeOtlpLayers = (
	config: TelemetryConfig,
	httpClientLayer: Layer.Layer<HttpClient.HttpClient>,
) => {
	const active = otlpActive(config);
	const { endpoints } = config.otlp;
	const base = signalBase(config);

	// Explicit logger set — console JSON (redacted) + span-event logger
	// always; the OTLP logger joins only when a logs endpoint resolved.
	// `mergeWithExisting` stays false so ambient loggers can't duplicate
	// records into the OTLP stream.
	const loggerLayer =
		active && endpoints.logs !== undefined
			? Logger.layer([
					consoleJsonLogger,
					Logger.tracerLogger,
					OtlpLogger.make({
						url: endpoints.logs,
						...base,
						maxBatchSize: config.otlp.maxBatchSize,
						excludeLogSpans: false,
					}),
				])
			: Logger.layer([consoleJsonLogger, Logger.tracerLogger]);

	// Head-sampling wraps the OTLP tracer so `tracesSampleRate` drops
	// whole traces consistently (unsampled spans never reach the exporter).
	const tracerLayer =
		active && endpoints.traces !== undefined
			? Layer.effect(
					Tracer.Tracer,
					Effect.map(
						OtlpTracer.make({
							url: endpoints.traces,
							...base,
							maxBatchSize: config.otlp.maxBatchSize,
						}),
						(tracer) => sampledTracer(tracer, config.tracesSampleRate),
					),
				)
			: Layer.empty;

	const metricsLayer =
		active && endpoints.metrics !== undefined
			? OtlpMetrics.layer({ url: endpoints.metrics, ...base })
			: Layer.empty;

	const signals = Layer.mergeAll(
		logLevelLayer(config),
		// Config warnings (e.g. insecure http endpoints dropped during
		// resolution) — logged whichever driver wins; the console driver
		// merges the same layer for the all-dropped case.
		telemetryWarningsLayer(config),
		loggerLayer,
		tracerLayer,
		metricsLayer,
		makeOtlpTelemetryLayer(config),
	);

	return signals.pipe(
		// Shared flush registry — exported so callers/tests can drain all
		// signals with one `flusher.flush`.
		Layer.provideMerge(OtlpExporter.layerFlusher),
		// Serialization + transport are consumed internally; keeping them
		// out of the merged output avoids leaking an HttpClient the app
		// may want to provide differently.
		Layer.provide(Layer.mergeAll(OtlpSerialization.layerJson, httpClientLayer)),
	);
};

/**
 * OTLP driver: eligible when at least one OTLP signal endpoint resolved
 * and `OTEL_SDK_DISABLED` is not set. Ordered BEFORE the console driver
 * in the registry — any eligible exporter wins; console stays the
 * always-eligible fallback.
 */
export const otlpTelemetryDriver: Driver<ObservabilityEnv> = {
	id: "telemetry-otlp",
	port: Telemetry.key,
	when: (env) => otlpActive(telemetryConfigFromEnv(env)),
	provides: (env) => makeOtlpLayers(telemetryConfigFromEnv(env), FetchHttpClient.layer),
};

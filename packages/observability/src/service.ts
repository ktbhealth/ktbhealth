import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PrometheusMetrics } from "effect/observability";

import type { TelemetryConfig } from "./config.ts";
import {
	sanitizeClientEvent,
	type ClientTelemetryBatch,
	type ClientTelemetryEvent,
} from "./ingest.ts";
import {
	clientEvents,
	clientEventsDropped,
	record,
	recordSafe,
	tagged,
	telemetryErrors,
} from "./metrics.ts";

/**
 * Telemetry port — the app-facing surface for observability lifecycle and
 * client ingest. Signal plumbing (Logger/Tracer/Metric) uses Effect's own
 * services; this service owns what they can't: bounded flush, Prometheus
 * exposition, browser-event ingest and exporter health.
 *
 * Drivers (`@ktb/observability` console, `@ktb/observability-otlp`) each
 * provide an implementation; the composition root picks one per deploy.
 */

export type ExporterKind = "console" | "otlp" | "prometheus" | "off";

export interface TelemetryHealth {
	readonly logs: ExporterKind;
	readonly traces: ExporterKind;
	readonly metrics: ExporterKind;
}

export interface TelemetryShape {
	/**
	 * Drain buffered telemetry (OTLP batch exporters). Bounded — never
	 * hangs the request/worker lifecycle; safe to call on every response
	 * via `ctx.waitUntil` and after queue batches.
	 */
	readonly flush: Effect.Effect<void>;
	/** Prometheus text exposition of the process-wide metric registry. */
	readonly scrape: Effect.Effect<string>;
	/**
	 * Ingest a validated client batch: sanitize → structured log per event
	 * → counters. Never fails — client telemetry is best-effort by
	 * contract; failures count on `ktb_telemetry_errors_total`.
	 */
	readonly ingest: (batch: ClientTelemetryBatch) => Effect.Effect<void>;
	/** Which exporters are live — for /api/ready and ops surfaces. */
	readonly health: Effect.Effect<TelemetryHealth>;
}

export class Telemetry extends Context.Service<Telemetry, TelemetryShape>()(
	"@ktb/observability/Telemetry",
) {}

const LOG_LEVEL_BY_TYPE = {
	event: "Info",
	error: "Error",
	navigation: "Info",
	request: "Info",
} as const;

/** Shared ingest implementation — both drivers use it; only the
 * surrounding exporters differ.
 *
 * `KTB_TELEMETRY_CLIENT_SAMPLE_RATE` is enforced HERE, server-side, per
 * event: each event flips a weighted coin (`random() < rate`), the same
 * convention `sampledTracer` uses for root spans. Server-side (not
 * client-side) because the env binding never reaches the browser and a
 * misconfigured/hostile client can't bypass it; `random` is injectable
 * for tests. */
export const ingestClientEvents =
	(config: TelemetryConfig, random: () => number = Math.random) =>
	(batch: ClientTelemetryBatch): Effect.Effect<void> =>
		Effect.gen(function* () {
			const { enabled, sampleRate } = config.clientTelemetry;
			if (!enabled) {
				yield* record(tagged(clientEventsDropped, { reason: "disabled" }), 1);
				return;
			}
			let sampledOut = 0;
			for (const raw of batch.events) {
				if (sampleRate < 1 && random() >= sampleRate) {
					sampledOut += 1;
					continue;
				}
				const event: ClientTelemetryEvent = sanitizeClientEvent(raw);
				const attrs: Record<string, string | number | boolean> = {
					type: event.type,
					...(event.name === "" ? {} : { name: event.name }),
					...(event.path === undefined ? {} : { path: event.path }),
					...(event.status === undefined ? {} : { status: event.status }),
					...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
					...(event.attributes ?? {}),
				};
				const message = `client.${event.type}`;
				const annotations: Record<string, unknown> = { ...attrs };
				if (event.message !== undefined) annotations["event.message"] = event.message;
				if (event.timestamp !== undefined) annotations["event.timestamp"] = event.timestamp;
				if (event.requestId !== undefined) annotations["telemetry.request_id"] = event.requestId;
				// annotateLogs (not a log* arg) so fields land in real log
				// annotations — OTLP attributes and the redactor both see them.
				const effect = (
					LOG_LEVEL_BY_TYPE[event.type] === "Error" ? Effect.logError : Effect.logInfo
				)(message).pipe(Effect.annotateLogs(annotations));
				yield* effect;
				if (event.stack !== undefined) {
					yield* Effect.logDebug("client.error.stack", { stack: event.stack });
				}
				yield* record(tagged(clientEvents, { type: event.type }), 1);
			}
			if (sampledOut > 0) {
				yield* record(tagged(clientEventsDropped, { reason: "sampled" }), sampledOut);
			}
		}).pipe(
			// Best-effort by contract: any failure or defect while logging
			// or counting events counts once on ktb_telemetry_errors_total
			// and never reaches the caller. `recordSafe` keeps the counter
			// itself from re-failing the handler.
			Effect.catchCause((cause) =>
				Effect.andThen(
					recordSafe(tagged(telemetryErrors, { stage: "ingest" }), 1),
					Effect.logError("telemetry.ingest.failed").pipe(
						Effect.annotateLogs({ cause: Cause.pretty(cause) }),
					),
				),
			),
		);

/**
 * Local driver implementation — console JSON logs + Prometheus scrape.
 * `flush` is a no-op (nothing buffers); `health` reports console/prometheus.
 */
export const makeLocalTelemetry = (
	config: TelemetryConfig,
	health: TelemetryHealth = { logs: "console", traces: "off", metrics: "prometheus" },
): TelemetryShape => ({
	flush: Effect.void,
	scrape: PrometheusMetrics.format(),
	ingest: ingestClientEvents(config),
	health: Effect.succeed(health),
});

/** Layer providing the local Telemetry service. */
export const TelemetryLocalLive = (config: TelemetryConfig, health?: TelemetryHealth) =>
	Layer.succeed(Telemetry, makeLocalTelemetry(config, health));

import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

/**
 * Platform metric definitions — the RED signals (rate, errors, duration)
 * plus domain counters, all provider-agnostic `effect/Metric` instruments.
 * Exposition is adapter-side: OTLP push (`@ktb/observability-otlp`) or
 * Prometheus pull via `Telemetry.scrape()` — the metrics themselves never
 * know where they go.
 *
 * Attribute discipline: labels are bounded-cardinality only (kind, side,
 * status class, event type). Never put ids, routes with parameters, or
 * user data on a metric — that's what traces and logs are for.
 */

/** App-runtime invocations (`run` system / `runAs` user) — the choke
 * point every server fn, page loader, job and webhook passes through. */
export const appInvocations = Metric.counter("ktb_app_invocations_total", {
	description: "Effect programs executed through the app runtime",
	// OTLP export maps isMonotonic from this flag — counters must be
	// incremental-only to export as monotonic sums.
	incremental: true,
});
export const appInvocationDuration = Metric.histogram("ktb_app_invocation_duration_ms", {
	description: "Wall time of app runtime invocations",
	boundaries: [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000],
});

/** CQRS dispatch volume — commands vs queries, plus failures. Recorded
 * in the shared bus middleware so every plugin group is covered. */
export const cqrsDispatches = Metric.counter("ktb_cqrs_dispatches_total", {
	description: "CQRS command/query dispatches",
	incremental: true,
});
export const cqrsDispatchDuration = Metric.histogram("ktb_cqrs_dispatch_duration_ms", {
	description: "CQRS dispatch wall time",
	boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000],
});
export const cqrsDispatchFailures = Metric.counter("ktb_cqrs_dispatch_failures_total", {
	description: "CQRS dispatches that ended in failure",
	incremental: true,
});

/** HTTP edge signals from the request middleware — handlerType
 * (`serverFn` | `router`) keeps server-fn traffic separable from page
 * loads; status is the response code (bounded).
 * NOTE: must be a counter, not Metric.frequency — the OTLP exporter
 * serializes a frequency's key as an attribute literally named `key`,
 * so `status` would never appear as a label and every status-based
 * dashboard/alert would silently read empty. */
export const httpRequests = Metric.counter("ktb_http_requests_total", {
	description: "HTTP requests by handler type and status",
	incremental: true,
});
export const httpRequestDuration = Metric.histogram("ktb_http_request_duration_ms", {
	description: "HTTP request wall time",
	boundaries: [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000],
});

/** Client telemetry ingest — events/errors received at /api/telemetry. */
export const clientEvents = Metric.counter("ktb_client_events_total", {
	description: "Browser telemetry events ingested",
	incremental: true,
});
export const clientEventsDropped = Metric.counter("ktb_client_events_dropped_total", {
	description: "Browser telemetry events rejected (disabled, invalid, rate-limited)",
	incremental: true,
});

/** Telemetry pipeline self-observability — export/ingest failures must
 * never be silent. Attribute `stage` is bounded: `ingest` (client-event
 * ingest failure), `export` (OTLP export attempt failure — counted per
 * attempt, so exporter retries may count more than once per batch),
 * `flush` (bounded drain timeout/failure, `reason: "timeout"` on
 * timeout). Client-side drops stay on `ktb_client_events_dropped_total`. */
export const telemetryErrors = Metric.counter("ktb_telemetry_errors_total", {
	description: "Telemetry pipeline errors (ingest, export, flush)",
	incremental: true,
});

export type MetricAttributes = Readonly<Record<string, string | number | boolean>>;

/** Tag a metric with bounded-cardinality attributes — values are
 * stringified because `Metric.AttributeSet` is `Record<string, string>`
 * (OTel attribute convention). */
export const tagged = <Input, State>(
	metric: Metric.Metric<Input, State>,
	attributes: MetricAttributes,
) =>
	Metric.withAttributes(
		metric,
		Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, String(v)])),
	);

/** Update a metric inside Effect — the normal path. */
export const record = <Input, State>(
	metric: Metric.Metric<Input, State>,
	input: Input,
): Effect.Effect<void> => Metric.update(metric, input);

/**
 * Update a metric from non-Effect edges (request middleware, queue
 * consumers, promise glue). Metrics live in the ambient
 * `MetricRegistry` reference with a process-wide default, so a sync
 * `runSync` lands in the same registry `Telemetry.scrape()` reads.
 * Never throws: metric failures are swallowed — observability must not
 * break the request path.
 */
export const recordUnsafe = <Input, State>(
	metric: Metric.Metric<Input, State>,
	input: Input,
): void => {
	try {
		Effect.runSync(Metric.update(metric, input));
	} catch {
		// Metrics are best-effort at the edge.
	}
};

/**
 * Like `record`, but also swallows defects — for failure-reporting paths
 * where the metric update itself must never fail the caller (e.g. the
 * `ktb_telemetry_errors_total` increments inside error handlers).
 */
export const recordSafe = <Input, State>(
	metric: Metric.Metric<Input, State>,
	input: Input,
): Effect.Effect<void> => Metric.update(metric, input).pipe(Effect.catchCause(() => Effect.void));

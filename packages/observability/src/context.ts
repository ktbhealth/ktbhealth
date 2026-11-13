import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";

/**
 * Request-scoped telemetry context — the correlation ids and identity
 * every log line, span and client event carries. Bound per invocation by
 * the composition root (`run`/`runAs` in @ktb/app-host merge the ambient
 * value with the acting user/tenant; the app edge seeds request id and
 * inbound `traceparent` from HTTP headers).
 *
 * A `Context.Reference` with an empty default — like `Tenant`/`Principal`
 * — so effects that never bind it still typecheck and run; ambient
 * context is never *inherited* into background work because `runAsTenant`
 * re-binds tenant explicitly while telemetry fields stay whatever the
 * caller provided (system flows pass none → empty).
 */
export interface TelemetryContextValue {
	/** Correlation id for this request/job — generated at the edge when
	 * the caller didn't supply `x-request-id`. */
	readonly requestId?: string;
	/** Raw inbound W3C `traceparent` header — the parent for every span
	 * the request opens, so traces continue across services. */
	readonly traceparent?: string;
	/** Logical route/handler name when known (pathname template, server
	 * fn id, queue name) — span/log attribute, never a raw URL with ids. */
	readonly route?: string;
	/** Acting user id — bound by `runAs`, absent for system flows. */
	readonly userId?: string;
	/** Resolved tenant id — bound by `runAs` next to `Tenant`. */
	readonly tenantId?: string | number | null;
}

export const TelemetryContext = Context.Reference<TelemetryContextValue>(
	"@ktb/observability/TelemetryContext",
	{ defaultValue: () => ({}) },
);

/** Read the ambient telemetry context (empty object when unbound). */
export const telemetryContext: Effect.Effect<TelemetryContextValue> =
	Effect.service(TelemetryContext);

/**
 * Merge `patch` into the ambient context for the duration of `effect`.
 * `undefined` fields leave the ambient value untouched; explicit `null`
 * on `tenantId` clears it (personal scope).
 */
export const withTelemetryContext = <A, E, R>(
	patch: {
		readonly requestId?: string;
		readonly traceparent?: string;
		readonly route?: string;
		readonly userId?: string;
		readonly tenantId?: string | number | null;
	},
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
	Effect.gen(function* () {
		const current = yield* TelemetryContext;
		const merged: TelemetryContextValue = {
			...current,
			...(patch.requestId === undefined ? {} : { requestId: patch.requestId }),
			...(patch.traceparent === undefined ? {} : { traceparent: patch.traceparent }),
			...(patch.route === undefined ? {} : { route: patch.route }),
			...(patch.userId === undefined ? {} : { userId: patch.userId }),
			...(patch.tenantId === undefined ? {} : { tenantId: patch.tenantId }),
		};
		return yield* Effect.provideService(effect, TelemetryContext, merged);
	});

/**
 * Log/span annotation projection of the ambient context — the fields
 * safe to attach to every record (no headers, no PII beyond opaque ids).
 * Used by `run`/`runAs` to stamp `Effect.annotateLogs` so correlation
 * reaches every log line automatically.
 */
export const telemetryAnnotations = (
	ctx: TelemetryContextValue,
): Record<string, string | number> => {
	const out: Record<string, string | number> = {};
	if (ctx.requestId !== undefined) out["telemetry.request_id"] = ctx.requestId;
	if (ctx.userId !== undefined) out["telemetry.user_id"] = ctx.userId;
	if (ctx.tenantId !== undefined && ctx.tenantId !== null)
		out["telemetry.tenant_id"] = ctx.tenantId;
	if (ctx.route !== undefined) out["telemetry.route"] = ctx.route;
	return out;
};

/** W3C traceparent: `00-<32 hex trace-id>-<16 hex span-id>-<2 hex flags>`. */
const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

/**
 * True when `value` is a syntactically valid W3C `traceparent` header.
 * Inbound correlation headers are client-controlled: edges must check
 * this before propagating the value into log fields, response headers
 * or span parents (`externalSpanFromTraceparent` re-validates anyway).
 */
export const isValidTraceparent = (value: string | null | undefined): value is string =>
	value !== null && value !== undefined && TRACEPARENT.test(value.trim());

/** Printable ASCII only (no spaces, controls or obs-text) — safe to
 * echo into log annotations and response headers verbatim. */
const REQUEST_ID = /^[!-~]{1,128}$/;

/**
 * Validate an inbound request/correlation id (`x-request-id`,
 * `x-trace-id`). Returns the trimmed id when it is printable ASCII
 * within the length cap, `undefined` otherwise — callers substitute a
 * freshly generated id rather than propagating attacker-controlled
 * bytes into logs, metrics labels and trace context.
 */
export const sanitizeRequestId = (value: string | null | undefined): string | undefined => {
	const trimmed = value?.trim();
	return trimmed !== undefined && REQUEST_ID.test(trimmed) ? trimmed : undefined;
};

/**
 * Parse a raw `traceparent` header value into an Effect `ExternalSpan`
 * suitable for `Effect.withSpan(..., { parent })` — continues an
 * incoming trace across the HTTP → Effect boundary. Returns undefined
 * for missing/malformed values (callers start a fresh trace).
 */
export const externalSpanFromTraceparent = (
	traceparent: string | undefined,
): Tracer.ExternalSpan | undefined => {
	if (traceparent === undefined) return undefined;
	const match = TRACEPARENT.exec(traceparent.trim());
	if (match === null) return undefined;
	const flags = Number.parseInt(match[3]!, 16);
	return Tracer.externalSpan({
		traceId: match[1] as string,
		spanId: match[2] as string,
		sampled: (flags & 0x01) === 0x01,
	});
};

const TRACE_ID_HEX = /^[0-9a-f]{32}$/i;
const SPAN_ID_HEX = /^[0-9a-f]{16}$/i;

/**
 * Build an `ExternalSpan` parent from edge log-record fields — the
 * correlation data an access log carries (`http.access` annotations).
 * Accepts, in order:
 *  1. `traceparent` — the raw inbound W3C header (preferred: carries the
 *     sampled flag);
 *  2. `traceId` + `spanId` — the already-split hex pair.
 * Returns `undefined` when neither pair is present/valid so callers can
 * emit the record uncorrelated instead of failing.
 *
 * Used by the app host's `logAccess` to run the access-log emission
 * inside a span parented to the request trace — that is what stamps the
 * OTLP `LogRecord.traceId`/`spanId` fields Loki/Tempo correlate on.
 */
export const externalSpanFromLogFields = (
	fields: Readonly<Record<string, unknown>>,
): Tracer.ExternalSpan | undefined => {
	const traceparent = fields["traceparent"];
	if (typeof traceparent === "string") {
		const span = externalSpanFromTraceparent(traceparent);
		if (span !== undefined) return span;
	}
	const traceId = fields["traceId"];
	const spanId = fields["spanId"];
	if (
		typeof traceId === "string" &&
		typeof spanId === "string" &&
		TRACE_ID_HEX.test(traceId) &&
		SPAN_ID_HEX.test(spanId)
	) {
		return Tracer.externalSpan({ traceId, spanId, sampled: true });
	}
	return undefined;
};

/**
 * Generate a request/correlation id — `crypto.randomUUID` where the
 * platform provides it (workerd, modern browsers, node ≥19), a
 * sufficiently-random fallback elsewhere. Never throws.
 */
export const newRequestId = (): string => {
	try {
		const cryptoObj = globalThis.crypto;
		if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
	} catch {
		// Fall through to the random fallback.
	}
	return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

import {
	isValidTraceparent,
	newRequestId,
	sanitizeRequestId,
	type TelemetryContextValue,
} from "@ktb/observability";

/**
 * App-edge telemetry glue: extracts request-scoped context (request id,
 * inbound W3C traceparent) from the TanStack Start request and hands it
 * to `run`/`runAs` in platform.ts, which seeds `TelemetryContext` inside
 * the Effect scope. Everything degrades to a fresh request id outside a
 * request context (queue consumers, tests, scripts).
 */

/** Read inbound telemetry headers via the Start server context. The
 * dynamic import mirrors packages/server-fns/src/session.ts — the
 * module only resolves inside a server request, so callers outside one
 * (queue handlers, vitest) take the catch path. */
const headersFromRequest = async (): Promise<Headers | null> => {
	try {
		const { getRequestHeaders } = await import("@tanstack/react-start/server");
		return getRequestHeaders();
	} catch {
		return null;
	}
};

/**
 * TelemetryContext seed for the current invocation: honors an upstream
 * `x-request-id`/`x-trace-id` (load balancer / caller correlation) and a
 * W3C `traceparent` for distributed tracing — but only after format
 * validation. These headers are client-controlled: malformed values are
 * dropped (fresh id / no parent) rather than propagated into logs,
 * metrics and trace context. Always guarantees a request id. Never
 * throws.
 */
export const requestTelemetryContext = async (): Promise<TelemetryContextValue> => {
	const headers = await headersFromRequest();
	if (headers === null) return { requestId: newRequestId() };
	const inboundId =
		sanitizeRequestId(headers.get("x-request-id")) ?? sanitizeRequestId(headers.get("x-trace-id"));
	const rawTraceparent = headers.get("traceparent");
	return {
		requestId: inboundId ?? newRequestId(),
		traceparent: isValidTraceparent(rawTraceparent) ? rawTraceparent : undefined,
	};
};

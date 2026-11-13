import { newRequestId, type TelemetryContextValue } from "@ktb/observability";

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
 * `x-request-id` (load balancer / caller correlation), accepts a W3C
 * `traceparent` for distributed tracing, and always guarantees a
 * request id. Never throws.
 */
export const requestTelemetryContext = async (): Promise<TelemetryContextValue> => {
	const headers = await headersFromRequest();
	if (headers === null) return { requestId: newRequestId() };
	const inboundId = headers.get("x-request-id") ?? headers.get("x-trace-id");
	return {
		requestId: inboundId ?? newRequestId(),
		traceparent: headers.get("traceparent") ?? undefined,
	};
};

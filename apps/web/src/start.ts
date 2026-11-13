import { createMiddleware, createStart } from "@tanstack/react-start";
import {
	getServerAsyncLocalStorage,
	overwriteServerAsyncLocalStorage,
} from "#/paraglide/runtime.js";
import { requestLocale } from "#/lib/i18n.ts";
import { accessLog } from "#/lib/access-log.ts";
import {
	newRequestId,
	recordUnsafe,
	tagged,
	httpRequests,
	httpRequestDuration,
} from "@ktb/observability";

// Runs every request inside paraglide's AsyncLocalStorage so getLocale()
// resolves the ktb-locale cookie during SSR — the cookie strategy cannot
// read request headers without it (paraglideMiddleware equivalent for
// TanStack Start's request-middleware pipeline).
const localeMiddleware = createMiddleware().server(async ({ request, next }) => {
	const locale = requestLocale(request);
	let als = getServerAsyncLocalStorage();
	if (!als) {
		const { AsyncLocalStorage } = await import("node:async_hooks");
		als = new AsyncLocalStorage();
		overwriteServerAsyncLocalStorage(als);
	}
	return als.run({ locale, origin: new URL(request.url).origin }, () => next());
});

/**
 * Edge observability middleware: request id + trace correlation, RED
 * metrics (rate/errors/duration) and a structured access log for EVERY
 * request — including non-Effect routes (auth, api, static) that never
 * reach `run`/`runAs`. Effect-level telemetry (spans, domain logs) is
 * seeded separately inside platform.ts from the same headers.
 */
const telemetryMiddleware = createMiddleware().server(
	async ({ request, next, handlerType, pathname }) => {
		const requestId = request.headers.get("x-request-id") ?? newRequestId();
		const traceparent = request.headers.get("traceparent") ?? undefined;
		const started = Date.now();
		const result = await next();
		const durationMs = Date.now() - started;

		// `next()` resolves to the shared pipeline result; `response` is
		// typed `Response` but SSR may hand back a wrapper carrying one.
		const exposed: unknown = result?.response;
		const response =
			exposed instanceof Response
				? exposed
				: exposed !== null && typeof exposed === "object" && "response" in exposed
					? ((exposed as { response?: unknown }).response as Response | undefined)
					: undefined;
		const status = response?.status ?? 0;

		recordUnsafe(tagged(httpRequests, { handlerType, status }), 1);
		recordUnsafe(tagged(httpRequestDuration, { handlerType }), durationMs);

		// Structured access log — emitted through the app runtime's logger
		// set (console JSON + OTLP) via the sink platform.ts registers, so
		// the record reaches exporters, not just Workers Logs. Falls back
		// to a raw console line before composition (see access-log.ts).
		await accessLog({
			method: request.method,
			path: pathname,
			status,
			handlerType,
			durationMs,
			requestId,
			traceId: traceparent?.split("-")[1],
		});

		// Echo correlation ids back so clients/support can quote them.
		// Response headers on a constructed Response are mutable pre-send.
		if (response) {
			response.headers.set("x-request-id", requestId);
			if (traceparent !== undefined) response.headers.set("x-traceparent", traceparent);
		}
		return result;
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [localeMiddleware, telemetryMiddleware],
}));

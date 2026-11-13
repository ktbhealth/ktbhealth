/**
 * Edge access-log sink (T-105). The request middleware in start.ts runs
 * outside the Effect runtime — before (and regardless of whether) any
 * request reaches `run`/`runAs` — so it cannot emit through the
 * configured logger set (`CurrentLoggers`: console JSON + OTLP) on its
 * own. `Effect.runSync` would use the Reference *default* loggers, not
 * the app's, which is exactly the gap this closes.
 *
 * platform.ts registers the composed app's `logAccess` here once the
 * composition root is built (server.ts imports platform.ts at module
 * scope, so the sink is live before the first request). Until then —
 * vitest, non-server contexts — records fall back to a raw
 * `console.info` JSON line so Workers Logs never goes dark.
 */

/** Bounded per-request access record — same fields the middleware has
 * always logged; values land as log annotations (OTLP attributes). */
export interface AccessLogFields {
	readonly method: string;
	readonly path: string;
	readonly status: number;
	readonly handlerType: string;
	readonly durationMs: number;
	readonly requestId: string;
	readonly traceId?: string;
}

type AccessLogSink = (fields: Readonly<Record<string, unknown>>) => Promise<void> | void;

let sink: AccessLogSink | undefined;

/** Register (or clear, with `undefined`) the runtime-backed sink.
 * Called once by platform.ts at composition; tests use it to stub. */
export const setAccessLogSink = (next: AccessLogSink | undefined): void => {
	sink = next;
};

/**
 * Emit the per-request `http.access` record. With a sink registered the
 * record flows through the app runtime's logger set — console JSON for
 * Workers Logs AND the OTLP exporter — matching every other log line.
 * Without one (tests, pre-composition) it degrades to the historical
 * flat `console.info` line. Never throws, never rejects.
 */
export const accessLog = async (fields: AccessLogFields): Promise<void> => {
	if (sink !== undefined) {
		try {
			// Drop undefined values so annotations stay clean (traceId is
			// absent when the request carried no traceparent).
			const clean = Object.fromEntries(
				Object.entries(fields).filter(([, value]) => value !== undefined),
			);
			await sink(clean);
		} catch {
			// Observability is best-effort at the edge.
		}
		return;
	}
	console.info(JSON.stringify({ message: "http.access", level: "INFO", ...fields }));
};

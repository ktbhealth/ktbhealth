import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";

import {
	clientEventsDropped,
	decodeClientTelemetryBatch,
	MAX_CLIENT_TELEMETRY_BODY_BYTES,
	readRequestBodyLimited,
	recordUnsafe,
	tagged,
	Telemetry,
} from "@ktb/observability";
import { run } from "#/lib/platform.ts";
import { checkTelemetryIngestRateLimit } from "#/lib/telemetry-rate-limit.ts";

/**
 * POST /api/telemetry — browser telemetry ingest. The client batches
 * events (errors, navigations, request timings) and posts them here;
 * the Telemetry service sanitizes, logs and counts them. Unauthenticated
 * by design (anonymous visitors generate telemetry too) — payloads are
 * schema-validated, sanitized and rate-shaped by construction; abuse is
 * bounded by the payload size cap, batch size caps, the disabled flag,
 * client-event sampling, and the fixed-window
 * ingest rate limit (per client IP + global ceiling — see
 * lib/telemetry-rate-limit.ts).
 */
async function handle({ request }: { request: Request }) {
	// Shed over-limit traffic before touching the body — invalid-payload
	// floods are rate-limited too. Limiter failures fail open (telemetry
	// is best-effort); a denied hit counts as a dropped batch.
	const rateLimit = checkTelemetryIngestRateLimit(request);
	if (!rateLimit.allowed) {
		recordUnsafe(tagged(clientEventsDropped, { reason: "rate_limited" }), 1);
		return Response.json(
			{ error: "rate limited" },
			{
				status: 429,
				headers: {
					"retry-after": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1_000))),
				},
			},
		);
	}
	// Body-size guard before any parsing: Content-Length is only a hint,
	// so the read itself is bounded (chunked/lied lengths can't smuggle
	// an unbounded payload into JSON.parse).
	const raw = await readRequestBodyLimited(request, MAX_CLIENT_TELEMETRY_BODY_BYTES);
	if (raw === null) {
		recordUnsafe(tagged(clientEventsDropped, { reason: "oversized" }), 1);
		return Response.json({ error: "payload too large" }, { status: 413 });
	}
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		recordUnsafe(tagged(clientEventsDropped, { reason: "invalid" }), 1);
		return Response.json({ error: "invalid json" }, { status: 400 });
	}
	const decoded = decodeClientTelemetryBatch(body);
	if (decoded._tag === "Failure") {
		recordUnsafe(tagged(clientEventsDropped, { reason: "invalid" }), 1);
		return Response.json({ error: "invalid payload" }, { status: 400 });
	}
	await run(
		Effect.gen(function* () {
			const telemetry = yield* Telemetry;
			yield* telemetry.ingest(decoded.value);
		}),
	);
	return new Response(null, { status: 204 });
}

export const Route = createFileRoute("/api/telemetry")({
	server: {
		handlers: {
			POST: handle,
			GET: () => Response.json({ error: "method not allowed" }, { status: 405 }),
		},
	},
});

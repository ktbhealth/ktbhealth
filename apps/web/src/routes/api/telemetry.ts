import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";

import { decodeClientTelemetryBatch, Telemetry } from "@ktb/observability";
import { run } from "#/lib/platform.ts";

/**
 * POST /api/telemetry — browser telemetry ingest. The client batches
 * events (errors, navigations, request timings) and posts them here;
 * the Telemetry service sanitizes, logs and counts them. Unauthenticated
 * by design (anonymous visitors generate telemetry too) — payloads are
 * schema-validated, sanitized and rate-shaped by construction; abuse is
 * bounded by batch size caps and the disabled flag.
 */
async function handle({ request }: { request: Request }) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid json" }, { status: 400 });
	}
	const decoded = decodeClientTelemetryBatch(body);
	if (decoded._tag === "Failure") {
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

import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { PluginStates } from "@ktb/platform/plugin-states";
import { Telemetry } from "@ktb/observability";
import { run } from "#/lib/platform.ts";

/**
 * Datastore probe with a bounded retry: D1-via-Hyperdrive reads
 * intermittently fail or stall while a binding cold-starts, which must
 * not flap readiness. `enabledIds` reaches the DB through
 * `Effect.promise`, so a rejected query surfaces as a defect, not a
 * typed error — `sandbox` folds the full cause into the error channel
 * so `Effect.retry` can see it. The schedule is exponential (4 retries,
 * 150ms → 2.4s worst case): it absorbs transient cold-start latency
 * while a genuinely down database still exhausts it and reports 503.
 */
const datastoreProbe = Effect.gen(function* () {
	const states = yield* PluginStates;
	yield* states.enabledIds();
});

const resilientProbe = Effect.retry(Effect.sandbox(datastoreProbe), {
	times: 4,
	schedule: Schedule.exponential("150 millis"),
});

/**
 * GET /api/ready — readiness probe: verifies the app runtime can reach
 * its datastore (PluginStates reads plugin_state) and reports which
 * telemetry exporters are live. 503 when the DB path fails so load
 * balancers/orchestrators stop routing until it recovers.
 */
async function handle() {
	try {
		const report = await run(
			Effect.gen(function* () {
				yield* resilientProbe;
				const telemetry = yield* Telemetry;
				return yield* telemetry.health;
			}),
		);
		return Response.json({ status: "ready", telemetry: report });
	} catch {
		return Response.json({ status: "unavailable" }, { status: 503 });
	}
}

export const Route = createFileRoute("/api/ready")({
	server: { handlers: { GET: handle } },
});

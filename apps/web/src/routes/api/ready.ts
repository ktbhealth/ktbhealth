import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";

import { PluginStates } from "@ktb/platform/plugin-states";
import { Telemetry } from "@ktb/observability";
import { run } from "#/lib/platform.ts";

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
				const states = yield* PluginStates;
				yield* states.enabledIds();
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

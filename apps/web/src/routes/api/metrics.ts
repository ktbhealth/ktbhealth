import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";

import { Telemetry } from "@ktb/observability";
import { PlatformAdmin } from "@ktb/platform";
import { getSessionUser } from "#/lib/auth.ts";
import { run } from "#/lib/platform.ts";
import { timingSafeEqual } from "#/lib/timing-safe.ts";
import { env } from "cloudflare:workers";

/**
 * GET /api/metrics — Prometheus text exposition of the process-wide
 * metric registry. Access is restricted: a platform-admin session OR a
 * bearer `METRICS_SCRAPE_TOKEN` binding (for pull-based scrapers that
 * can't hold a session). Metrics can reveal traffic shapes, so they're
 * never world-readable.
 */
async function handle({ request }: { request: Request }) {
	const token = (env as { METRICS_SCRAPE_TOKEN?: string }).METRICS_SCRAPE_TOKEN;
	// Timing-safe compare: plain string equality would leak the token
	// through early-exit timing on a scrape endpoint.
	const provided = request.headers.get("authorization");
	const authorized =
		token !== undefined &&
		token !== "" &&
		provided !== null &&
		(await timingSafeEqual(provided, `Bearer ${token}`));
	// Platform admins may also scrape — metrics reveal traffic shapes, so
	// they're never world-readable.
	const isAdmin = authorized
		? false
		: await (async () => {
				const user = await getSessionUser();
				if (user === null) return false;
				return run(
					Effect.gen(function* () {
						const gate = yield* PlatformAdmin;
						return yield* gate.isAdmin(user.email);
					}),
				).catch(() => false);
			})();
	if (!authorized && !isAdmin) return new Response("forbidden", { status: 403 });
	const text = await run(
		Effect.gen(function* () {
			const telemetry = yield* Telemetry;
			return yield* telemetry.scrape;
		}),
	);
	return new Response(text, {
		headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
	});
}

export const Route = createFileRoute("/api/metrics")({
	server: { handlers: { GET: handle } },
});

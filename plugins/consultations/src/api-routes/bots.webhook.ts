import { Effect } from "effect";

import { Consultations, consultationTenantId } from "@ktb/consultations";
import { Db } from "@ktb/db";
import { createPluginApiRoute, run } from "@ktb/server-fns";
import { runAsTenantId } from "@ktb/tenant";

/**
 * POST /api/bots/webhook — transcript events from the bot provider.
 *
 * Real providers (Recall) post segments with participant names —
 * the channel separation IS the diarization. We persist
 * "Speaker: text" lines; AnamnesisExtractor unchanged.
 *
 * Moved from apps/web/src/routes/api/bots.webhook.ts — services and
 * the runtime boundary resolve through @ktb/server-fns.
 */
export const Route = createPluginApiRoute("consultations.routes")("/api/bots/webhook")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const body = (await request.json()) as {
					consultationId?: number;
					botId?: string;
					speaker?: string;
					text?: string;
					final?: boolean;
					end?: boolean;
				};
				const { consultationId, botId } = body;
				if (!consultationId || !botId) {
					return Response.json({ error: "missing consultationId/botId" }, { status: 400 });
				}
				return run(
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						const db = yield* Db;
						if (!(yield* consultations.ownedByBot(consultationId, botId))) {
							return Response.json({ error: "forbidden" }, { status: 403 });
						}
						// System path: re-bind tenant scope from the row's
						// tenant_id (P-053 phase D) — the webhook payload
						// carries no tenant and ambient context is never
						// inherited. null = personal scope.
						const tenantId = yield* Effect.promise(() => consultationTenantId(db, consultationId));
						if (body.end) {
							yield* runAsTenantId(tenantId, consultations.finish(consultationId));
						} else if (body.text) {
							const line = body.speaker ? `${body.speaker}: ${body.text}` : body.text;
							yield* runAsTenantId(tenantId, consultations.appendTranscript(consultationId, line));
						}
						return Response.json({ ok: true });
					}),
				);
			},
		},
	},
});

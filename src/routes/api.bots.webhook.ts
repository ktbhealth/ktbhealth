import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { consultations } from "#/db/schema.ts";
import { appendTranscript, finishConsultation } from "#/lib/consultations.ts";

/**
 * POST /api/bots/webhook — transcript events from the bot provider.
 *
 * Real providers (Recall) post segments with participant names —
 * the channel separation IS the diarization. We persist
 * "Speaker: text" lines; AnamnesisExtractor unchanged.
 */
export const Route = createFileRoute("/api/bots/webhook")({
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
				if (!body.consultationId || !body.botId) {
					return Response.json(
						{ error: "missing consultationId/botId" },
						{ status: 400 },
					);
				}
				const owned = await db
					.select({ id: consultations.id })
					.from(consultations)
					.where(
						and(
							eq(consultations.id, body.consultationId),
							eq(consultations.botId, body.botId),
						),
					)
					.limit(1);
				if (!owned.length) {
					return Response.json({ error: "forbidden" }, { status: 403 });
				}
				if (body.end) {
					await finishConsultation(body.consultationId);
				} else if (body.text) {
					const line = body.speaker
						? `${body.speaker}: ${body.text}`
						: body.text;
					await appendTranscript(body.consultationId, line);
				}
				return Response.json({ ok: true });
			},
		},
	},
});

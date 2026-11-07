import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { Consultations } from "@ktb/consultations";
import { run } from "#/lib/platform.ts";

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
				const { consultationId, botId } = body;
				if (!consultationId || !botId) {
					return Response.json({ error: "missing consultationId/botId" }, { status: 400 });
				}
				return run(
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						if (!(yield* consultations.ownedByBot(consultationId, botId))) {
							return Response.json({ error: "forbidden" }, { status: 403 });
						}
						if (body.end) {
							yield* consultations.finish(consultationId);
						} else if (body.text) {
							const line = body.speaker ? `${body.speaker}: ${body.text}` : body.text;
							yield* consultations.appendTranscript(consultationId, line);
						}
						return Response.json({ ok: true });
					}),
				);
			},
		},
	},
});

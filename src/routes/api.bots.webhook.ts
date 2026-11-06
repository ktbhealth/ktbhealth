import { createFileRoute } from "@tanstack/react-router";

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
					speaker?: string;
					text?: string;
					final?: boolean;
					end?: boolean;
				};
				if (!body.consultationId) {
					return Response.json(
						{ error: "missing consultationId" },
						{ status: 400 },
					);
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

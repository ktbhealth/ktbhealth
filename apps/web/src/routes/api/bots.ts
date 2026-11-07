import { createFileRoute } from "@tanstack/react-router";
import { ensureSessionUser } from "#/lib/auth.ts";
import { db } from "#/lib/platform.ts";
import { STUB_CALL } from "@ktb/bot";
import { selectBotProvider } from "@ktb/bot-recall";
import { appendTranscript, createConsultation, finishConsultation } from "@ktb/consultations";

/**
 * POST /api/bots — send a bot into a teleconsult.
 * { meetUrl } → { consultationId, botId, provider }
 *
 * With a real provider (RECALL_API_KEY), transcript events arrive at
 * /api/bots/webhook. With the stub provider, we simulate them
 * in-process — same appendTranscript path the webhook uses.
 */
export const Route = createFileRoute("/api/bots")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const body = (await request.json()) as { meetUrl?: string };
				if (!body.meetUrl) {
					return Response.json({ error: "missing meetUrl" }, { status: 400 });
				}

				const provider = selectBotProvider();
				const webhookUrl = new URL("/api/bots/webhook", request.url).toString();
				const session = await provider.join(body.meetUrl, webhookUrl);
				const user = await ensureSessionUser();

				const consultationId = await createConsultation(db, {
					userId: user.id,
					source: "bot",
					status: "live",
					botId: session.botId,
				});
				if (!consultationId) {
					return Response.json({ error: "failed to create consultation" }, { status: 500 });
				}

				if (provider.name === "stub") {
					void simulateCall(consultationId);
				}

				return Response.json({
					consultationId,
					botId: session.botId,
					provider: provider.name,
				});
			},
		},
	},
});

async function simulateCall(consultationId: number) {
	for (const seg of STUB_CALL) {
		await new Promise((r) => setTimeout(r, seg.delayMs));
		await appendTranscript(db, consultationId, `${seg.speaker}: ${seg.text}`);
	}
	await finishConsultation(db, consultationId);
}

import { createFileRoute } from "@tanstack/react-router";
import { ensureSessionUser } from "#/lib/auth.ts";
import { run, runAs } from "#/lib/platform.ts";
import { STUB_CALL } from "@ktb/bot";
import { Bot } from "@ktb/bot";
import { Effect } from "effect";
import { Consultations } from "@ktb/consultations";

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

				// Bot is provided by the composed app runtime (driver-selected
				// in @ktb/app-host) — routes never touch impl layers directly.
				const provider = await run(
					Effect.gen(function* () {
						return yield* Bot;
					}),
				);
				const webhookUrl = new URL("/api/bots/webhook", request.url).toString();
				const session = await provider.join(body.meetUrl, webhookUrl);
				const user = await ensureSessionUser();

				const consultationId = await runAs(
					user,
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						return yield* consultations.create({
							userId: user.id,
							source: "bot",
							status: "live",
							botId: session.botId,
						});
					}),
				);
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

// Simulated-call appends run on the system path (`run`, no Principal):
// appendTranscript/finish are bot-channel methods authorized by the
// botId binding established at create time — same as the real webhook.
async function simulateCall(consultationId: number) {
	await run(
		Effect.gen(function* () {
			const consultations = yield* Consultations;
			for (const seg of STUB_CALL) {
				yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, seg.delayMs)));
				yield* consultations.appendTranscript(consultationId, `${seg.speaker}: ${seg.text}`);
			}
			yield* consultations.finish(consultationId);
		}),
	);
}

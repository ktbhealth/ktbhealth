import { createFileRoute } from "@tanstack/react-router";
import { ensureDoctorUser } from "#/lib/auth.ts";
import { run, runAs } from "#/lib/platform.ts";
import { STUB_CALL } from "@ktb/bot";
import { Bot } from "@ktb/bot";
import { Effect } from "effect";
import { Consultations } from "@ktb/consultations";
import { Tenant, runAsTenantId, tenantScopeId } from "@ktb/tenant";

/**
 * POST /api/bots — send a bot into a teleconsult.
 * { meetUrl } → { consultationId, botId, provider }
 *
 * With a real provider (RECALL_API_KEY), transcript events arrive at
 * /api/bots/webhook. With the stub provider (dev only — outside dev a
 * missing RECALL_API_KEY is a 503), we simulate them in-process — same
 * appendTranscript path the webhook uses.
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
				// The stub provider fabricates a whole call — dev-only. A
				// production deploy without RECALL_API_KEY must fail loudly
				// instead of silently "joining" a fake bot.
				if (provider.name === "stub" && !import.meta.env.DEV) {
					console.warn(
						"[bots] stub provider selected outside dev (RECALL_API_KEY missing) — refusing to simulate",
					);
					return Response.json({ error: "meeting bot is not configured" }, { status: 503 });
				}
				const webhookUrl = new URL("/api/bots/webhook", request.url).toString();
				const session = await provider.join(body.meetUrl, webhookUrl);
				const user = await ensureDoctorUser();

				const created = await runAs(
					user,
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						const tenant = yield* Tenant;
						const id = yield* consultations.create({
							userId: user.id,
							source: "bot",
							status: "live",
							botId: session.botId,
						});
						// Tenant id stamped on the row travels with the
						// simulated call so its system-path appends re-bind
						// the same scope (P-053 phase D).
						return { id, tenantId: tenantScopeId(tenant) };
					}),
				);
				const consultationId = created.id;
				if (!consultationId) {
					return Response.json({ error: "failed to create consultation" }, { status: 500 });
				}

				if (provider.name === "stub") {
					// import.meta.env.DEV was checked above — reaching here
					// means dev mode, where simulation is allowed.
					console.warn("[bots] stub provider — simulating call", { consultationId });
					void simulateCall(consultationId, created.tenantId);
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
// `tenantId` is the tenant stamped at create; the appends re-bind it
// explicitly since ambient tenant never crosses into background work.
async function simulateCall(consultationId: number, tenantId: number | null) {
	await run(
		runAsTenantId(
			tenantId,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				for (const seg of STUB_CALL) {
					yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, seg.delayMs)));
					yield* consultations.appendTranscript(consultationId, `${seg.speaker}: ${seg.text}`);
				}
				yield* consultations.finish(consultationId);
			}),
		),
	);
}

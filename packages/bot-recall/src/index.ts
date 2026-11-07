import { StubBotProvider } from "@ktb/bot";
import type { BotProvider, BotSession } from "@ktb/bot";

const BASE = "https://api.recall.ai/api/v1";

/** Recall.ai — real adapter, needs RECALL_API_KEY. */
export class RecallBotProvider implements BotProvider {
	readonly name = "recall";

	async join(meetUrl: string, webhookUrl: string): Promise<BotSession> {
		const key = process.env.RECALL_API_KEY;
		if (!key) throw new Error("RECALL_API_KEY not set");
		const res = await fetch(`${BASE}/bot`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Token ${key}`,
			},
			body: JSON.stringify({
				meeting_url: meetUrl,
				bot_name: "Anamnese",
				transcription_options: { provider: "default" },
				realtime_endpoints: [
					{
						type: "webhook",
						url: webhookUrl,
						events: ["transcript.data"],
					},
				],
			}),
		});
		if (!res.ok) throw new Error(`recall api: ${res.status}`);
		const data = (await res.json()) as { id: string };
		return { botId: data.id, provider: this.name };
	}
}

/**
 * Stub provider — simulates a bot joining and emitting diarized
 * transcript events over time. Lets the whole teleconsult flow be
 * demoed end-to-end without a Recall account.
 */

export function selectBotProvider(): BotProvider {
	return process.env.RECALL_API_KEY ? new RecallBotProvider() : new StubBotProvider();
}

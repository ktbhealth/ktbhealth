import { Bot } from "@ktb/bot";
import type { BotProvider, BotSession } from "@ktb/bot";
import * as Layer from "effect/Layer";
import type { Driver } from "@ktb/driver-framework";

const BASE = "https://api.recall.ai/api/v1";

/** Env slice the recall driver inspects (mirrors app-host AppEnv). */
export interface RecallDriverEnv {
	readonly RECALL_API_KEY?: string;
}

/** Recall.ai — real adapter, needs RECALL_API_KEY. */
export class RecallBotProvider implements BotProvider {
	readonly name = "recall";

	constructor(private readonly apiKey: string) {}

	async join(meetUrl: string, webhookUrl: string): Promise<BotSession> {
		const res = await fetch(`${BASE}/bot`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Token ${this.apiKey}`,
			},
			body: JSON.stringify({
				meeting_url: meetUrl,
				bot_name: "KTB Health",
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
 * Recall driver: eligible only when RECALL_API_KEY is bound. Ordered
 * before `stubBotDriver` (@ktb/bot) in the host registry — the stub is
 * the always-eligible fallback.
 */
export const recallDriver: Driver<RecallDriverEnv> = {
	id: "bot-recall",
	port: Bot.key,
	provides: (env) => Layer.succeed(Bot, new RecallBotProvider(env.RECALL_API_KEY ?? "")),
	when: (env) => Boolean(env.RECALL_API_KEY),
};

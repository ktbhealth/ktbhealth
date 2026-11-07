import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

/**
 * BotProvider port — server-side meeting-bot source (ADR-0001).
 *
 * A bot joins the teleconsult, and per-participant audio channels
 * give speaker labels for free — diarization solved by the call
 * platform, not by us. Transcript events arrive via webhook.
 */

export interface BotSession {
	botId: string;
	provider: string;
}

export interface BotProvider {
	readonly name: string;
	join(meetUrl: string, webhookUrl: string): Promise<BotSession>;
}

export class StubBotProvider implements BotProvider {
	readonly name = "stub";

	async join(_meetUrl: string, _webhookUrl: string): Promise<BotSession> {
		return {
			botId: `stub-${Math.random().toString(36).slice(2, 10)}`,
			provider: this.name,
		};
	}
}

/** Canned diarized consult used by the stub source (and demos). */
export const STUB_CALL: Array<{
	speaker: string;
	text: string;
	delayMs: number;
}> = [
	{ speaker: "Médico", text: "Bom dia, o que te traz hoje?", delayMs: 1200 },
	{
		speaker: "Paciente",
		text: "Uma dor de cabeça que não passa faz três dias.",
		delayMs: 2200,
	},
	{
		speaker: "Médico",
		text: "Desde quando exatamente? Teve febre?",
		delayMs: 1800,
	},
	{
		speaker: "Paciente",
		text: "Começou segunda-feira. Ontem à tarde medi 38 graus.",
		delayMs: 2400,
	},
	{
		speaker: "Médico",
		text: "Você tem alguma condição de saúde conhecida?",
		delayMs: 1800,
	},
	{
		speaker: "Paciente",
		text: "Sou hipertenso há cinco anos, tomo losartana 50 mg por dia.",
		delayMs: 2400,
	},
	{ speaker: "Médico", text: "Alergia a algum medicamento?", delayMs: 1600 },
	{
		speaker: "Paciente",
		text: "Não que eu saiba. Minha mãe tem enxaqueca, se ajuda.",
		delayMs: 2200,
	},
	{
		speaker: "Médico",
		text: "Entendi. Vou examinar e já conversamos sobre o que fazer.",
		delayMs: 2000,
	},
];

/** Bot service tag — impls provide via Layer (stub, recall, ...). */
export class Bot extends Context.Service<Bot, BotProvider>()("@ktb/bot/Bot") {}

/** Local stub layer: simulates a bot without a provider account. */
export const StubBotLive = Layer.succeed(Bot, new StubBotProvider());

import { PROMPT } from "./prompt.ts";
import type { Anamnesis, AnamnesisExtractor } from "./types.ts";

/**
 * OpenAI-compatible extractor — any chat-completions endpoint.
 * Env: LLM_API_KEY (or OPENAI_API_KEY), LLM_BASE_URL, LLM_MODEL.
 */
export class OpenAIExtractor implements AnamnesisExtractor {
	readonly name = "openai";

	async extract(transcript: string): Promise<Anamnesis> {
		const key = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
		if (!key) throw new Error("LLM_API_KEY not set");
		const base = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
		const model = process.env.LLM_MODEL ?? "gpt-4o-mini";

		const res = await fetch(`${base}/chat/completions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${key}`,
			},
			body: JSON.stringify({
				model,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: PROMPT },
					{ role: "user", content: transcript },
				],
			}),
		});
		if (!res.ok) throw new Error(`llm api: ${res.status}`);
		const data = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const text = data.choices?.[0]?.message?.content ?? "";
		return JSON.parse(text.replace(/```json|```/g, "").trim()) as Anamnesis;
	}
}

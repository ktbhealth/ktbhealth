import type { Anamnesis, AnamnesisExtractor } from "./types.ts";

const PROMPT = `Você é um assistente de documentação clínica. Dada a transcrição de uma consulta em português, produza uma anamnese estruturada.

Responda APENAS com JSON válido neste formato exato:
{
  "queixa_principal": {"content": "...", "confidence": "alta|media|baixa", "evidence": ["frase literal da transcrição"]},
  "hda": {...}, "antecedentes": {...}, "alergias": {...},
  "medicamentos_em_uso": {...}, "exame_fisico": {...},
  "hipoteses": {...}, "conduta": {...}
}

Regras:
- Todo campo DEVE ter "evidence" com as frases literais da transcrição que o fundamentam (ou [] se não informado).
- confidence="baixa" quando a informação não consta na transcrição.
- NÃO invente exame físico, hipóteses ou conduta — escreva "A preencher pelo médico" quando ausente.
- Estilo de prontuário: conciso, terminologia clínica, PT-BR.

TRANSCRIÇÃO:
`;

export class AnthropicExtractor implements AnamnesisExtractor {
	readonly name = "anthropic";

	async extract(transcript: string): Promise<Anamnesis> {
		const key = process.env.ANTHROPIC_API_KEY;
		if (!key) throw new Error("ANTHROPIC_API_KEY not set");

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": key,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: "claude-haiku-4-5",
				max_tokens: 4096,
				messages: [{ role: "user", content: PROMPT + transcript }],
			}),
		});
		if (!res.ok) throw new Error(`anthropic api: ${res.status}`);
		const data = (await res.json()) as {
			content?: Array<{ type: string; text?: string }>;
		};
		const text = data.content?.find((c) => c.type === "text")?.text ?? "";
		return JSON.parse(text.replace(/```json|```/g, "").trim()) as Anamnesis;
	}
}

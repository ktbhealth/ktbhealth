export * from "@ktb/anamnesis";
import { AnthropicExtractor } from "./anthropic.ts";
import { HeuristicExtractor } from "@ktb/anamnesis";
import { OpenAIExtractor } from "./openai.ts";
import type { Anamnesis, AnamnesisExtractor } from "@ktb/anamnesis";

export type { Anamnesis, AnamnesisSection, Confidence } from "@ktb/anamnesis";
export { SECTION_LABELS } from "@ktb/anamnesis";

/** Adapter selection — LLM when configured, deterministic fallback otherwise. */
export function selectExtractor(): AnamnesisExtractor {
	if (process.env.ANTHROPIC_API_KEY) return new AnthropicExtractor();
	if (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY) return new OpenAIExtractor();
	return new HeuristicExtractor();
}

export async function extractAnamnesis(
	transcript: string,
): Promise<{ anamnesis: Anamnesis; engine: string }> {
	const primary = selectExtractor();
	try {
		return {
			anamnesis: await primary.extract(transcript),
			engine: primary.name,
		};
	} catch {
		const fallback = new HeuristicExtractor();
		return {
			anamnesis: await fallback.extract(transcript),
			engine: `${primary.name}!fallback`,
		};
	}
}
export * from "./review.ts";

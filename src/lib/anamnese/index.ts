import { AnthropicExtractor } from "./anthropic.ts";
import { HeuristicExtractor } from "./heuristic.ts";
import { OpenAIExtractor } from "./openai.ts";
import type { Anamnesis, AnamnesisExtractor } from "./types.ts";

export type { Anamnesis, AnamnesisSection, Confidence } from "./types.ts";
export { SECTION_LABELS } from "./types.ts";

/** Adapter selection — LLM when configured, deterministic fallback otherwise. */
export function selectExtractor(): AnamnesisExtractor {
	if (process.env.ANTHROPIC_API_KEY) return new AnthropicExtractor();
	if (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY)
		return new OpenAIExtractor();
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

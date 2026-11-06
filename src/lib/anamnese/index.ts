import { AnthropicExtractor } from "./anthropic.ts";
import { HeuristicExtractor } from "./heuristic.ts";
import type { Anamnesis, AnamnesisExtractor } from "./types.ts";

export type { Anamnesis, AnamnesisSection, Confidence } from "./types.ts";
export { SECTION_LABELS } from "./types.ts";

/** Adapter selection — LLM when configured, deterministic fallback otherwise. */
export function selectExtractor(): AnamnesisExtractor {
	return process.env.ANTHROPIC_API_KEY
		? new AnthropicExtractor()
		: new HeuristicExtractor();
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

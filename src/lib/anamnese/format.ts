import type { Anamnesis, AnamnesisSectionKey } from "./types.ts";
import { SECTION_LABELS } from "./types.ts";

/** Plain-text rendering of the anamnese (clipboard). */
export function anamnesisToText(anamnesis: Anamnesis): string {
	return (Object.keys(SECTION_LABELS) as AnamnesisSectionKey[])
		.map((k) => `${SECTION_LABELS[k].toUpperCase()}\n${anamnesis[k].content}`)
		.join("\n\n");
}

import type { Anamnesis, AnamnesisSectionKey } from "./types.ts";
import { SECTION_LABELS } from "./types.ts";

/** Plain-text rendering of the anamnesis (clipboard). Section labels are English; section content is pt-BR clinical text. */
export function anamnesisToText(anamnesis: Anamnesis): string {
	return (Object.keys(SECTION_LABELS) as AnamnesisSectionKey[])
		.map((k) => `${SECTION_LABELS[k].toUpperCase()}\n${anamnesis[k].content}`)
		.join("\n\n");
}

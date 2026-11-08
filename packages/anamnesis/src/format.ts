import type { Anamnesis, AnamnesisSectionKey } from "./types.ts";
import { HISTORY_SECTION_LABEL, SECTION_LABELS } from "./types.ts";

/** Plain-text rendering of the anamnesis (clipboard). Section labels are English; section content is pt-BR clinical text. */
export function anamnesisToText(anamnesis: Anamnesis): string {
	const parts = (Object.keys(SECTION_LABELS) as AnamnesisSectionKey[]).map(
		(k) => `${SECTION_LABELS[k].toUpperCase()}\n${anamnesis[k].content}`,
	);
	if (anamnesis.historico) {
		parts.push(`${HISTORY_SECTION_LABEL.toUpperCase()}\n${anamnesis.historico.content}`);
	}
	return parts.join("\n\n");
}

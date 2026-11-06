/**
 * AnamnesisExtractor port — server-side structuring.
 *
 * Turns a consult transcript into a structured anamnese. Every
 * section carries `evidence` (the source sentences that justify it)
 * and `confidence` — the doctor reviews text, never re-listens.
 */

export type Confidence = "alta" | "media" | "baixa";

export interface AnamnesisSection {
	content: string;
	confidence: Confidence;
	/** Verbatim transcript sentences that ground this section. */
	evidence: string[];
}

export interface Anamnesis {
	queixa_principal: AnamnesisSection;
	hda: AnamnesisSection;
	antecedentes: AnamnesisSection;
	alergias: AnamnesisSection;
	medicamentos_em_uso: AnamnesisSection;
	exame_fisico: AnamnesisSection;
	hipoteses: AnamnesisSection;
	conduta: AnamnesisSection;
}

export type AnamnesisSectionKey = keyof Anamnesis;

export const SECTION_LABELS: Record<AnamnesisSectionKey, string> = {
	queixa_principal: "Queixa principal",
	hda: "História da doença atual",
	antecedentes: "Antecedentes",
	alergias: "Alergias",
	medicamentos_em_uso: "Medicamentos em uso",
	exame_fisico: "Exame físico",
	hipoteses: "Hipóteses diagnósticas",
	conduta: "Conduta",
};

export interface AnamnesisExtractor {
	readonly name: string;
	extract(transcript: string): Promise<Anamnesis>;
}

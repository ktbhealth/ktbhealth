/**
 * AnamnesisExtractor port — server-side structuring.
 *
 * Turns a consult transcript into a structured anamnesis. Every
 * section carries `evidence` (the source sentences that justify it)
 * and `confidence` — the doctor reviews text, never re-listens.
 *
 * Section keys and confidence values are the persisted document
 * schema (stored JSON, LLM wire format) and intentionally stay
 * pt-BR; only the human-facing labels are English.
 */

export type Confidence = "alta" | "media" | "baixa";

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
	alta: "high confidence",
	media: "medium confidence",
	baixa: "low confidence",
};

export interface AnamnesisSection {
	readonly content: string;
	readonly confidence: Confidence;
	/** Verbatim transcript sentences that ground this section. */
	readonly evidence: readonly string[];
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
	queixa_principal: "Chief complaint",
	hda: "History of present illness",
	antecedentes: "Past medical history",
	alergias: "Allergies",
	medicamentos_em_uso: "Current medications",
	exame_fisico: "Physical examination",
	hipoteses: "Diagnostic hypotheses",
	conduta: "Management plan",
};

export interface AnamnesisExtractor {
	readonly name: string;
	extract(transcript: string): Promise<Anamnesis>;
}

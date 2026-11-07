/**
 * AnamnesisExtractor port — server-side structuring.
 *
 * Turns a consult transcript into a structured anamnese. Every
 * section carries `evidence` (the source sentences that justify it)
 * and `confidence` — the doctor reviews text, never re-listens.
 */

export type Confidence = "alta" | "media" | "baixa";

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

// ---------- second-opinion review ----------

/** A piece of information the consult did not capture. */
export interface ReviewGap {
	readonly secao: AnamnesisSectionKey;
	readonly o_que_falta: string;
	/** Question the doctor could still ask the patient. */
	readonly pergunta_sugerida: string;
	/** Why it matters clinically. */
	readonly motivo: string;
}

export interface ReviewHypothesis {
	readonly diagnostico: string;
	readonly probabilidade: Confidence;
	readonly raciocinio: string;
	/** Verbatim transcript sentences supporting this hypothesis. */
	readonly evidence: readonly string[];
	/** Exams/steps that would confirm or exclude it. */
	readonly investigar: readonly string[];
}

/**
 * Second pass by a stronger model. NEVER merged into the anamnese
 * silently: it is decision support, the doctor accepts item by item.
 */
export interface AnamnesisReview {
	readonly lacunas: readonly ReviewGap[];
	readonly hipoteses: readonly ReviewHypothesis[];
	readonly sinais_de_alerta: readonly string[];
	readonly inconsistencias: readonly string[];
}

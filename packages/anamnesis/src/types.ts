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
	/**
	 * Factual snapshot of the patient's prior consultations, injected
	 * deterministically at extraction time. Optional: documents written
	 * before patient history existed — and unlinked patients — omit it.
	 * Not part of AnamnesisSectionKey: it is context, not a clinical
	 * section the doctor edits.
	 */
	readonly historico?: AnamnesisSection;
}

/** The eight clinical sections — `historico` is deliberately excluded. */
export type AnamnesisSectionKey = Exclude<keyof Anamnesis, "historico">;

export const HISTORY_SECTION_LABEL = "Prior consultations";

/**
 * Factual summary of one prior consultation, produced by the
 * consultations plugin from stored anamneses. `date` is ISO 8601;
 * complaint/plan are null when the prior record had none.
 */
export interface PriorVisit {
	readonly id: number;
	readonly date: string;
	readonly chiefComplaint: string | null;
	readonly plan: string | null;
}

/** A patient's consultation history: total count + the latest visits. */
export interface PatientHistory {
	readonly count: number;
	readonly visits: readonly PriorVisit[];
}

/**
 * Demographics from the patient record (FHIR Patient.gender / birthDate),
 * resolved server-side. Context for the drafter only — never evidence.
 */
export interface PatientContext {
	/** FHIR AdministrativeGender label, e.g. "female". */
	readonly sex?: string;
	/** Whole years (approximate when the record only has a birth year). */
	readonly age?: number;
}

/** Input to AnamnesisEngine.extract — transcript plus optional patient context. */
export interface ExtractInput {
	readonly transcript: string;
	readonly history?: PatientHistory;
	readonly patient?: PatientContext;
}

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

import type { PatientContext, PatientHistory } from "@ktb/anamnesis";
import { priorVisitLine } from "@ktb/anamnesis";

const RULES = `You are a clinical documentation assistant. Given the transcript of a consultation in Portuguese, produce a structured anamnesis.

Respond ONLY with valid JSON in this exact format:
{
  "queixa_principal": {"content": "...", "confidence": "alta|media|baixa", "evidence": ["literal sentence from the transcript"]},
  "hda": {...}, "antecedentes": {...}, "alergias": {...},
  "medicamentos_em_uso": {...}, "exame_fisico": {...},
  "hipoteses": {...}, "conduta": {...}
}

Rules:
- Every field MUST have "evidence" with the literal transcript sentences that support it (or [] if not reported).
- confidence="baixa" when the information is not present in the transcript.
- Do NOT invent physical exam findings, hypotheses, or management — write "A preencher pelo médico" when absent.
- Medical record style: concise, clinical terminology, output content in PT-BR.`;

export const PROMPT = `${RULES}\n\nTRANSCRIPT:\n`;

const patientLine = (patient?: PatientContext | null): string =>
	[patient?.sex, patient?.age === undefined ? undefined : `${patient.age} years old`]
		.filter(Boolean)
		.join(", ");

/**
 * System prompt with optional patient context. Both blocks are factual
 * record data — demographics to phrase the record correctly and history
 * for continuity — never clinical suggestions, and never a source for
 * "evidence" quotes.
 */
export function buildPrompt(
	history?: PatientHistory | null,
	patient?: PatientContext | null,
): string {
	const blocks: string[] = [];
	const demographics = patientLine(patient);
	if (demographics) {
		blocks.push(
			`PATIENT — from the patient record (context only, NOT evidence): ${demographics}. Never quote it in "evidence".`,
		);
	}
	if (history && history.visits.length > 0) {
		const lines = history.visits.map(priorVisitLine).join("\n");
		blocks.push(`PATIENT HISTORY — factual record of this patient's prior consultations (context only, NOT clinical suggestions):
${lines}
Use it solely to recognize continuity with previous visits (recurring complaints, prior plans). Never recommend, diagnose, or change management based on it, and never quote it in "evidence" — evidence must come from the current transcript only.`);
	}
	if (blocks.length === 0) return PROMPT;
	return `${RULES}

${blocks.join("\n\n")}

TRANSCRIPT:
`;
}

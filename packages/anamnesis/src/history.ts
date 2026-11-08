import type { Anamnesis, AnamnesisSection, PatientHistory, PriorVisit } from "./types.ts";

/**
 * Patient-history helpers — turn a PatientHistory (factual summaries of
 * prior consultations) into the anamnesis `historico` block and into
 * prompt lines. Everything here is deterministic record data: the LLM
 * never invents history, it only receives it as context.
 */

/** Placeholder texts the extractors emit for absent fields — not facts. */
const PENDING = "A preencher";

/** A stored section's content as a citable fact, or null when absent/pending. */
export function factContent(content: string | null | undefined): string | null {
	const trimmed = content?.trim();
	if (!trimmed || trimmed.startsWith(PENDING)) return null;
	return trimmed;
}

/** ISO date → pt-BR short date (DD/MM/YYYY), locale-independent. */
export function formatVisitDate(iso: string): string {
	const [y, m, d] = iso.slice(0, 10).split("-");
	return `${d}/${m}/${y}`;
}

/** One factual line per prior visit; missing fields are simply omitted. */
export function priorVisitLine(visit: PriorVisit): string {
	const facts = [
		visit.chiefComplaint ? `queixa "${visit.chiefComplaint}"` : null,
		visit.plan ? `conduta "${visit.plan}"` : null,
	].filter((f): f is string => f !== null);
	const head = `- ${formatVisitDate(visit.date)} (#${visit.id})`;
	return facts.length ? `${head}: ${facts.join("; ")}` : head;
}

/** The `historico` section for a history snapshot, or null when empty. */
export function patientHistorySection(
	history: PatientHistory | null | undefined,
): AnamnesisSection | null {
	if (!history || history.visits.length === 0) return null;
	return {
		content: [
			`Consultas anteriores (${history.count}):`,
			...history.visits.map(priorVisitLine),
			"Registro factual do prontuário — contexto, não sugestão clínica.",
		].join("\n"),
		confidence: "alta",
		evidence: history.visits.map((v) => `consulta #${v.id} · ${v.date}`),
	};
}

/**
 * Attach the deterministic history block to an extracted anamnesis.
 * The field is owned by this helper: model output for `historico` is
 * always replaced (history present) or dropped (no history), so the
 * document can never carry invented prior-visit facts.
 */
export function anamnesisWithHistory(
	anamnesis: Anamnesis,
	history?: PatientHistory | null,
): Anamnesis {
	const section = patientHistorySection(history);
	if (section) return { ...anamnesis, historico: section };
	const { historico: _dropped, ...rest } = anamnesis;
	return rest;
}

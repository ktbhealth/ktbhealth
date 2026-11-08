import type { Anamnesis, AnamnesisExtractor, AnamnesisSection } from "./types.ts";

/**
 * HeuristicExtractor — deterministic pt-BR extraction.
 *
 * Always works, zero cost, zero latency — the fallback when no LLM
 * key is configured, and the baseline the LLM adapter must beat.
 * Section content stays pt-BR: it is clinical document text.
 */

const SYMPTOM =
	/\b(dor|febre|tosse|náusea|vômito|tontura|cansaço|fadiga|falta de ar|diarreia|cefaleia|enjoo|azia|mancha|coceira|inchaço|sangramento|insônia|ansiedade)\b/i;
const TIME =
	/\b(há\s+\w+|desde|faz\s+\w+|começou|iniciou|ontem|hoje|semana|mês|dia|dias|anos?|horas)\b/i;
const ALLERGY = /alerg/i;
const MEDS =
	/\b(tomo|toma|tomando|uso|usando|em uso|remédio|medicamento|mg|comprimido|gotas|insulina|anticoncepcional|losartana|metformina|sinvastatina|omeprazol)\b/i;
const HISTORY =
	/\b(diabet\w*|hipertens\w*|asma|cardiop\w*|infarto|avc|fuma|tabag\w*|etil|cirurg\w*|interna\w*|histórico|mãe|pai|família|câncer|depress\w*)\b/i;

function section(content: string, evidence: string[]): AnamnesisSection {
	return {
		content,
		confidence: evidence.length ? "media" : "baixa",
		evidence,
	};
}

function toFill(label: string): AnamnesisSection {
	return {
		content: `A preencher pelo médico: ${label}.`,
		confidence: "baixa",
		evidence: [],
	};
}

export class HeuristicExtractor implements AnamnesisExtractor {
	readonly name = "heuristic";

	async extract(transcript: string): Promise<Anamnesis> {
		const sentences = transcript
			.split(/(?<=[.!?])\s+|\n+/)
			.map((s) => s.trim())
			.filter((s) => s.length > 2);

		const allergy = sentences.filter((s) => ALLERGY.test(s));
		const meds = sentences.filter((s) => MEDS.test(s) && !ALLERGY.test(s));
		const history = sentences.filter((s) => HISTORY.test(s));
		const symptoms = sentences.filter((s) => SYMPTOM.test(s));
		const temporal = sentences.filter((s) => TIME.test(s));

		const qp = symptoms[0] ?? sentences[0] ?? "";
		const claimed = new Set([...allergy, ...meds, ...history, qp]);
		const hda = [...new Set([...symptoms.filter((s) => s !== qp), ...temporal])].filter(
			(s) => !claimed.has(s) || temporal.includes(s),
		);

		return {
			queixa_principal: section(qp || "Não identificada.", qp ? [qp] : []),
			hda: section(
				hda.length ? hda.join(" ") : "Sem detalhes temporais extraídos. Revisar transcrição.",
				hda,
			),
			antecedentes: section(history.length ? history.join(" ") : "Nega / não informado.", history),
			alergias: section(allergy.length ? allergy.join(" ") : "Nega / não informado.", allergy),
			medicamentos_em_uso: section(meds.length ? meds.join(" ") : "Nenhum informado.", meds),
			exame_fisico: toFill("não registrado em áudio"),
			hipoteses: toFill("julgamento clínico"),
			conduta: toFill("julgamento clínico"),
		};
	}
}

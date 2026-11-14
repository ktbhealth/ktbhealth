import type { LocaleProfile, ScriptContent } from "../locale.ts";

/**
 * pt-BR locale profile — the default `LocaleProfile` for the eval
 * core. All pt-BR-specific behavior lives here: numeral words,
 * speaker labels, decimal separator, PHI patterns (CPF/BR phone/DOB
 * phrasing), the ASR language hint, and the consultation slot
 * tables. metrics/anonymize/scriptgen/pipeline consume it through
 * the `LocaleProfile` interface — nothing here is imported by name
 * outside this file except via the profile object.
 */

// ---------- number words (0–9999) ----------

const UNITS = [
	"zero",
	"um",
	"dois",
	"três",
	"quatro",
	"cinco",
	"seis",
	"sete",
	"oito",
	"nove",
	"dez",
	"onze",
	"doze",
	"treze",
	"quatorze",
	"quinze",
	"dezesseis",
	"dezessete",
	"dezoito",
	"dezenove",
];
const TENS = [
	"",
	"",
	"vinte",
	"trinta",
	"quarenta",
	"cinquenta",
	"sessenta",
	"setenta",
	"oitenta",
	"noventa",
];
const HUNDREDS = [
	"",
	"cento",
	"duzentos",
	"trezentos",
	"quatrocentos",
	"quinhentos",
	"seiscentos",
	"setecentos",
	"oitocentos",
	"novecentos",
];

/** pt-BR number words 0–9999 — "50"→"cinquenta" (a dose), never
 * "cinco zero". Approximation is fine: ref and hyp normalize the
 * same way. */
const numberToWords = (n: number): string => {
	if (n < 20) return UNITS[n]!;
	if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? ` e ${UNITS[n % 10]}` : "");
	if (n === 100) return "cem";
	if (n < 1000) {
		const rest = n % 100;
		return HUNDREDS[Math.floor(n / 100)]! + (rest ? ` e ${numberToWords(rest)}` : "");
	}
	if (n < 10000) {
		const rest = n % 1000;
		const head = n === 1000 ? "mil" : `${numberToWords(Math.floor(n / 1000))} mil`;
		return head + (rest ? ` ${rest < 100 ? "e " : ""}${numberToWords(rest)}` : "");
	}
	return String(n);
};

// ---------- PHI patterns (moved verbatim from anonymize.ts) ----------

const PII_PATTERNS: LocaleProfile["piiPatterns"] = [
	// CPF: 123.456.789-00 or 12345678900 (word-bounded).
	{
		category: "cpf",
		re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
		token: "[CPF]",
	},
	// BR phones: (11) 91234-5678 | 11 91234-5678 | 9+8-digit runs.
	{
		category: "phone",
		re: /\b(?:\(?\d{2}\)?\s?)?9?\d{4}-?\d{4}\b/g,
		token: "[PHONE]",
	},
	{ category: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, token: "[EMAIL]" },
	// Date of birth phrasing — "nascido em 12/03/1985", "DN: 12-03-1985".
	{
		category: "date_of_birth",
		re: /\b(?:nascid[ao](?:\sem)?|data de nascimento[:\s]?|DN[:\s])\s*\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/gi,
		token: "[DOB]",
	},
];

// ---------- script slot tables (moved verbatim from scriptgen.ts) ----------

const SCRIPT: ScriptContent = {
	greeting: {
		formal: ["Bom dia. Sou o médico responsável pelo seu atendimento. Em que posso ajudar?"],
		colloquial: [
			"Oi, bom dia! Me conta o que tá acontecendo.",
			"Bom dia! Como posso te ajudar hoje?",
		],
	},

	chiefComplaint: {
		general_practice: {
			formal: ["Refiro cefaleia intensa há três dias, sem melhora com repouso."],
			colloquial: ["Tô com uma dor de cabeça muito forte faz uns três dias."],
		},
		pediatrics: {
			formal: ["A criança apresenta febre e recusa alimentar desde ontem."],
			colloquial: ["Minha filha tá com febre e não quer comer nada desde ontem."],
		},
		gynecology: {
			formal: ["Apresento cólicas intensas e alteração do ciclo menstrual."],
			colloquial: ["Tô com cólica muito forte e minha menstruação tá desregulada."],
		},
		geriatrics: {
			formal: ["Refiro tonturas frequentes ao levantar, há duas semanas."],
			colloquial: ["Tô ficando tonto toda vez que eu levanto, já tem umas duas semanas."],
		},
		cardiology: {
			formal: ["Refiro dor precordial aos esforços e dispneia associada."],
			colloquial: ["Sinto um aperto no peito quando ando e fico sem fôlego."],
		},
		psychiatry: {
			formal: ["Refiro insônia persistente e episódios de ansiedade."],
			colloquial: ["Não tô conseguindo dormir direito e ando muito ansioso."],
		},
	},

	allergyQuestion: {
		formal: ["O senhor possui alergia conhecida a algum medicamento?"],
		colloquial: ["Você tem alergia a algum remédio?"],
	},

	// Denial variants paired with their negation marker — the gold
	// entity is the MARKER, not the utterance: losing "não"/"nega" is the
	// dangerous event, and substring alignment stays robust to ASR word
	// errors elsewhere in the phrase.
	allergyDeny: [
		{ marker: "não tenho alergia", text: "não tenho alergia a remédio nenhum" },
		{ marker: "nega alergia", text: "nega alergia a medicamentos" },
	],

	allergyAffirm: [
		{ med: "penicilina", text: "sou alérgico a penicilina" },
		{ med: "dipirona", text: "sou alérgico a dipirona" },
	],

	prescriptions: {
		general_practice: [
			{ med: "dipirona", dose: "500 mg", freq: "de 8 em 8 horas" },
			{ med: "losartana", dose: "50 mg", freq: "uma vez ao dia" },
		],
		pediatrics: [
			{ med: "dipirona em gotas", dose: "20 gotas", freq: "de 6 em 6 horas" },
			{ med: "amoxicilina em suspensão", dose: "5 ml", freq: "de 8 em 8 horas" },
		],
		gynecology: [
			{ med: "ácido fólico", dose: "5 mg", freq: "uma vez ao dia" },
			{ med: "ibuprofeno", dose: "400 mg", freq: "de 8 em 8 horas" },
		],
		geriatrics: [
			{ med: "losartana", dose: "50 mg", freq: "uma vez ao dia" },
			{ med: "sinvastatina", dose: "20 mg", freq: "à noite" },
		],
		cardiology: [
			{ med: "atenolol", dose: "25 mg", freq: "uma vez ao dia" },
			{ med: "losartana", dose: "50 mg", freq: "uma vez ao dia" },
		],
		psychiatry: [
			{ med: "sertralina", dose: "50 mg", freq: "uma vez ao dia" },
			{ med: "lorazepam", dose: "1 mg", freq: "à noite" },
		],
	},

	prescriptionText: {
		formal: (p) => `Prescrevo ${p.med} ${p.dose}, ${p.freq}.`,
		colloquial: (p) => `Vou te passar ${p.med} ${p.dose}, você toma ${p.freq}, tá bom?`,
	},

	closing: {
		formal: ["Retorne em quinze dias para reavaliação."],
		colloquial: ["Volta aqui em umas duas semanas pra gente ver como você tá, tá certo?"],
	},

	regionMarker: {
		southeast: "uai",
		south: "tchê",
		northeast: "oxente",
		north: "massa",
		central_west: "meu",
	},
	fallbackRegionMarker: "uai",
};

/** The default profile — normalization id "ptbr-v1" is what
 * StageMetrics.normalization persists; keep it stable. */
export const ptBR: LocaleProfile = {
	id: "ptbr-v1",
	asrLanguage: "pt",
	numberToWords,
	// Case-insensitive + tolerant of "Dr."-style abbreviations; runs
	// after lowercasing in normalize but must also work when callers
	// disable `lowercase`.
	speakerLabelRe: /\b(doctor|patient|médico|medico|paciente|doutor|doutora|dr|dra)\.?\s*:/gi,
	decimalWord: "virgula",
	piiPatterns: PII_PATTERNS,
	// Residual long digit runs — likely an id/document (see
	// gateTranscript in anonymize.ts).
	residualIdRe: /\b\d{8,}\b/,
	script: SCRIPT,
};

/**
 * scriptgen.ts — seed-deterministic script rendering for the synthetic
 * dataset (T-099).
 *
 * Pipeline: persona + seed → slot tables pick pt-BR content → `.eta`
 * template lays out the consultation → gold entities are emitted by the
 * SAME slot selection that produced the text (gold is never inferred
 * from rendered text — no circularity).
 *
 * Template sources arrive as strings — domain code never touches the
 * filesystem; adapters (or tests) read `templates/*.eta`.
 *
 * Slot names are English literals; rendered content is pt-BR. Provider
 * details (voice ids, engines) never appear here.
 */

import { Eta } from "eta";

import type { GoldEntity, Persona } from "./schema.ts";

export interface ScriptTurn {
	readonly speaker: "doctor" | "patient";
	readonly text: string;
}

export interface ScriptRender {
	readonly script: string;
	readonly turns: readonly ScriptTurn[];
	readonly entities: readonly GoldEntity[];
	readonly seed: number;
}

/** Deterministic PRNG (mulberry32) — same seed → same slot picks. */
const rng = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

// ---------- slot tables (English keys, pt-BR content) ----------

const GREETING: Record<string, readonly string[]> = {
	formal: ["Bom dia. Sou o médico responsável pelo seu atendimento. Em que posso ajudar?"],
	colloquial: [
		"Oi, bom dia! Me conta o que tá acontecendo.",
		"Bom dia! Como posso te ajudar hoje?",
	],
};

const COMPLAINT: Record<string, Record<string, readonly string[]>> = {
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
};

const ALLERGY_QUESTION: Record<string, readonly string[]> = {
	formal: ["O senhor possui alergia conhecida a algum medicamento?"],
	colloquial: ["Você tem alergia a algum remédio?"],
};

/** Denial variants paired with their negation marker — the gold
 * entity is the MARKER, not the utterance: losing "não"/"nega" is the
 * dangerous event, and substring alignment stays robust to ASR word
 * errors elsewhere in the phrase. */
const ALLERGY_DENY: readonly { marker: string; text: string }[] = [
	{ marker: "não tenho alergia", text: "não tenho alergia a remédio nenhum" },
	{ marker: "nega alergia", text: "nega alergia a medicamentos" },
];

const ALLERGY_AFFIRM: readonly { med: string; text: string }[] = [
	{ med: "penicilina", text: "sou alérgico a penicilina" },
	{ med: "dipirona", text: "sou alérgico a dipirona" },
];

interface Prescription {
	readonly med: string;
	readonly dose: string;
	readonly freq: string;
}

const PRESCRIPTION: Record<string, readonly Prescription[]> = {
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
};

const PRESCRIPTION_TEXT: Record<string, (p: Prescription) => string> = {
	formal: (p) => `Prescrevo ${p.med} ${p.dose}, ${p.freq}.`,
	colloquial: (p) => `Vou te passar ${p.med} ${p.dose}, você toma ${p.freq}, tá bom?`,
};

const CLOSING: Record<string, readonly string[]> = {
	formal: ["Retorne em quinze dias para reavaliação."],
	colloquial: ["Volta aqui em umas duas semanas pra gente ver como você tá, tá certo?"],
};

const REGION_MARKER: Record<string, string> = {
	southeast: "uai",
	south: "tchê",
	northeast: "oxente",
	north: "massa",
	central_west: "meu",
};

// ---------- context builder ----------

/** Builds the render context for a persona+seed. All randomness flows
 * through `rng(seed)` — no Date/Math.random, so output is replayable. */
export const buildScriptContext = (persona: Persona, seed: number) => {
	const rand = rng(seed);
	const register = persona.register === "formal" ? "formal" : "colloquial";
	const specialty =
		COMPLAINT[persona.specialty] !== undefined ? persona.specialty : "general_practice";

	const chiefComplaint = pick(rand, COMPLAINT[specialty]![register]!);
	const marked =
		register === "colloquial"
			? `${REGION_MARKER[persona.region] ?? "uai"}, ${chiefComplaint}`
			: chiefComplaint;

	const denyAllergy = rand() < 0.6;
	const deny = pick(rand, ALLERGY_DENY);
	const affirm = pick(rand, ALLERGY_AFFIRM);
	const allergyAnswer = denyAllergy ? deny.text : affirm.text;

	const rx = pick(rand, PRESCRIPTION[specialty]!);
	const entities: GoldEntity[] = [
		...(denyAllergy ? [{ category: "negation" as const, value: deny.marker }] : []),
		...(denyAllergy ? [] : [{ category: "medication" as const, value: affirm.med }]),
		{ category: "medication", value: rx.med },
		{ category: "dosage", value: rx.dose },
		{ category: "frequency", value: rx.freq },
	];

	const slots = {
		greeting: pick(rand, GREETING[register]!),
		chief_complaint: marked,
		allergy_question: pick(rand, ALLERGY_QUESTION[register]!),
		allergy_answer: allergyAnswer,
		prescription: PRESCRIPTION_TEXT[register]!(rx),
		closing: pick(rand, CLOSING[register]!),
	};

	const turns: ScriptTurn[] = [
		{ speaker: "doctor", text: slots.greeting },
		{ speaker: "patient", text: slots.chief_complaint },
		{ speaker: "doctor", text: slots.allergy_question },
		{ speaker: "patient", text: slots.allergy_answer },
		{ speaker: "doctor", text: slots.prescription },
		{ speaker: "doctor", text: slots.closing },
	];

	return { persona, slots, turns, entities };
};

// ---------- render ----------

// autoTrim: false — a consultation is one turn per line; Eta's default
// slurping would collapse every turn into a single line.
const eta = new Eta({ autoEscape: false, autoTrim: false });

/** Renders a script from an `.eta` template source. Pure — the caller
 * supplies the template string; output is fully determined by
 * (template, persona, seed). */
export const renderScript = (input: {
	readonly template: string;
	readonly persona: Persona;
	readonly seed: number;
}): ScriptRender => {
	const ctx = buildScriptContext(input.persona, input.seed);
	const script = eta
		.renderString(input.template, ctx)
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.join("\n");
	return { script, turns: ctx.turns, entities: ctx.entities, seed: input.seed };
};

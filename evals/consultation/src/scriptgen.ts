/**
 * scriptgen.ts — seed-deterministic script rendering for the synthetic
 * dataset (T-099).
 *
 * Pipeline: persona + seed → slot tables pick locale content → `.eta`
 * template lays out the consultation → gold entities are emitted by the
 * SAME slot selection that produced the text (gold is never inferred
 * from rendered text — no circularity).
 *
 * Template sources arrive as strings — domain code never touches the
 * filesystem; adapters (or tests) read `templates/<locale>/*.eta`.
 *
 * Slot names are English literals; rendered content is locale data —
 * it lives in the active LocaleProfile (`locales/pt-BR.ts` is the
 * default). Provider details (voice ids, engines) never appear here.
 */

import { Eta } from "eta";

import type { LocaleProfile, ScriptContent, ScriptPrescription } from "./locale.ts";
import { ptBR } from "./locales/pt-BR.ts";
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

// ---------- context builder ----------

/** Builds the render context for a persona+seed. All randomness flows
 * through `rng(seed)` — no Date/Math.random, so output is replayable.
 * Slot content comes from `profile.script` — the locale owns the
 * strings, this function owns the selection logic. */
export const buildScriptContext = (
	persona: Persona,
	seed: number,
	profile: LocaleProfile = ptBR,
) => {
	const c: ScriptContent = profile.script;
	const rand = rng(seed);
	const register = persona.register === "formal" ? "formal" : "colloquial";
	const specialty =
		c.chiefComplaint[persona.specialty] !== undefined ? persona.specialty : "general_practice";

	const chiefComplaint = pick(rand, c.chiefComplaint[specialty]![register]!);
	const marked =
		register === "colloquial"
			? `${c.regionMarker[persona.region] ?? c.fallbackRegionMarker}, ${chiefComplaint}`
			: chiefComplaint;

	const denyAllergy = rand() < 0.6;
	const deny = pick(rand, c.allergyDeny);
	const affirm = pick(rand, c.allergyAffirm);
	const allergyAnswer = denyAllergy ? deny.text : affirm.text;

	const rx: ScriptPrescription = pick(rand, c.prescriptions[specialty]!);
	const entities: GoldEntity[] = [
		...(denyAllergy ? [{ category: "negation" as const, value: deny.marker }] : []),
		...(denyAllergy ? [] : [{ category: "medication" as const, value: affirm.med }]),
		{ category: "medication", value: rx.med },
		{ category: "dosage", value: rx.dose },
		{ category: "frequency", value: rx.freq },
	];

	const slots = {
		greeting: pick(rand, c.greeting[register]!),
		chief_complaint: marked,
		allergy_question: pick(rand, c.allergyQuestion[register]!),
		allergy_answer: allergyAnswer,
		prescription: c.prescriptionText[register]!(rx),
		closing: pick(rand, c.closing[register]!),
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
 * (template, persona, seed, profile). */
export const renderScript = (input: {
	readonly template: string;
	readonly persona: Persona;
	readonly seed: number;
	/** Locale profile — slot content + entity markers. Default pt-BR. */
	readonly profile?: LocaleProfile;
}): ScriptRender => {
	const ctx = buildScriptContext(input.persona, input.seed, input.profile);
	const script = eta
		.renderString(input.template, ctx)
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.join("\n");
	return { script, turns: ctx.turns, entities: ctx.entities, seed: input.seed };
};

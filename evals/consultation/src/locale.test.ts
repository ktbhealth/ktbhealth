import { describe, expect, it } from "vitest";

import { anonymize, gateTranscript } from "./anonymize.ts";
import type { LocaleProfile, ScriptContent } from "./locale.ts";
import { ptBR } from "./locales/pt-BR.ts";
import { checkEntities, normalize, NORMALIZATION_PROFILE, wer } from "./metrics.ts";
import { buildScriptContext, renderScript } from "./scriptgen.ts";
import type { Persona } from "./schema.ts";

/**
 * Locale-profile injection tests (T-118): a toy "xx" profile must
 * change normalize/numberToWords/speaker-label/PII/script behavior,
 * while every default stays pt-BR. The profile is plain data — no
 * framework, no registry lookup.
 */

const XX_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const XX_SCRIPT: ScriptContent = {
	greeting: { formal: ["Good day."], colloquial: ["Hi there."] },
	chiefComplaint: {
		general_practice: {
			formal: ["I report a severe headache for three days."],
			colloquial: ["I've got a bad headache for three days."],
		},
	},
	allergyQuestion: { formal: ["Any known allergy?"], colloquial: ["Allergies?"] },
	allergyDeny: [{ marker: "no allergy", text: "I have no allergy to medication" }],
	allergyAffirm: [{ med: "aspirin", text: "I am allergic to aspirin" }],
	prescriptions: {
		general_practice: [{ med: "ibuprofen", dose: "200 mg", freq: "twice daily" }],
	},
	prescriptionText: {
		formal: (p) => `I prescribe ${p.med} ${p.dose}, ${p.freq}.`,
		colloquial: (p) => `Take ${p.med} ${p.dose} ${p.freq}, okay?`,
	},
	closing: { formal: ["Return in two weeks."], colloquial: ["See you soon, okay?"] },
	regionMarker: { testland: "y'all" },
	fallbackRegionMarker: "hey",
};

const xx: LocaleProfile = {
	...ptBR,
	id: "xx-v1",
	asrLanguage: "xx",
	numberToWords: (n) => XX_WORDS[n] ?? String(n),
	speakerLabelRe: /\bdoc\.?\s*:/gi,
	decimalWord: "point",
	piiPatterns: [{ category: "cpf", re: /\bXX-\d{4}\b/g, token: "[XXID]" }],
	residualIdRe: /\b\d{6,}\b/,
	script: XX_SCRIPT,
};

describe("ptBR default profile", () => {
	it("is the ptbr-v1 normalization profile", () => {
		expect(ptBR.id).toBe("ptbr-v1");
		expect(NORMALIZATION_PROFILE).toBe(ptBR.id);
		expect(ptBR.asrLanguage).toBe("pt");
	});

	it("keeps pt-BR normalization behavior unchanged", () => {
		expect(normalize("50 mg")).toBe("cinquenta mg");
		expect(normalize("2,5 mg")).toBe("dois virgula cinco mg");
		expect(normalize("Paciente: dor")).toBe("dor");
	});
});

describe("profile injection — normalize/metrics", () => {
	it("a custom profile changes number words, decimal word and speaker labels", () => {
		// pt-BR would read "Doc:" as plain text, expand 2→"dois" and
		// use "virgula"; xx strips "Doc:", says "two" and "point".
		expect(normalize("Doc: take 2.5 mg now", { profile: xx })).toBe("take two point five mg now");
		expect(normalize("Doc: take 2.5 mg now")).toBe("doc take dois virgula cinco mg now");
	});

	it("wer honors the injected profile", () => {
		// Under xx, "2" normalizes to "two" on both sides → WER 0;
		// under pt-BR the same pair is "dois" vs "two"… actually both
		// sides normalize identically per profile, so compare a case
		// where the profile changes the token stream: "Doc:" is
		// stripped by xx but kept by pt-BR.
		const ref = "Doc: hello";
		const hyp = "hello";
		expect(wer(ref, hyp, { profile: xx })).toBe(0);
		expect(wer(ref, hyp)).toBeGreaterThan(0);
	});

	it("checkEntities matches under the injected profile", () => {
		const entities = [{ category: "medication" as const, value: "2 mg" }];
		// "2"→"two" under xx, so the entity value must be looked up the
		// same way — present in hyp "take two mg".
		const verdicts = checkEntities(entities, "take two mg now", xx);
		expect(verdicts[0]?.status).toBe("correct");
		// pt-BR would expand "2"→"dois" and miss "two".
		expect(checkEntities(entities, "take two mg now")[0]?.status).toBe("dropped");
	});
});

describe("profile injection — anonymize", () => {
	it("scrubs the locale's own PII patterns, not pt-BR's", () => {
		const out = anonymize("id XX-1234 e cpf 123.456.789-00", xx);
		expect(out.text).toContain("[XXID]");
		expect(out.text).toContain("123.456.789-00"); // pt-BR CPF untouched
		expect(out.redactions).toEqual([{ category: "cpf", count: 1 }]);
	});

	it("gateTranscript uses the profile's residual-id heuristic", () => {
		// 6-digit run trips xx's residualIdRe but not pt-BR's (8+).
		expect(gateTranscript("registro 123456 ok", xx)).toBeNull();
		expect(gateTranscript("registro 123456 ok")).not.toBeNull();
	});
});

describe("profile injection — scriptgen", () => {
	const persona = (over?: Partial<Persona>): Persona => ({
		region: "testland",
		ageBand: "adult",
		register: "formal",
		specialty: "general_practice",
		...over,
	});

	it("buildScriptContext renders the profile's slot content", () => {
		const ctx = buildScriptContext(persona(), 7, xx);
		expect(ctx.slots.greeting).toBe("Good day.");
		expect(ctx.slots.allergy_question).toBe("Any known allergy?");
		expect(ctx.slots.prescription).toContain("ibuprofen");
		expect(ctx.entities.map((e) => e.value)).toContain("ibuprofen");
		expect(ctx.entities.map((e) => e.value)).toContain("200 mg");
	});

	it("colloquial register uses the profile's region marker fallback", () => {
		const ctx = buildScriptContext(persona({ register: "colloquial", region: "nowhere" }), 7, xx);
		expect(ctx.slots.chief_complaint.startsWith("hey, ")).toBe(true);
	});

	it("renderScript is fully determined by (template, persona, seed, profile)", () => {
		const template = "<%= it.slots.greeting %>\n<%= it.slots.prescription %>";
		const r = renderScript({ template, persona: persona(), seed: 3, profile: xx });
		expect(r.script).toContain("Good day.");
		expect(r.script).toContain("I prescribe ibuprofen 200 mg, twice daily.");
	});

	it("default stays pt-BR when no profile is passed", () => {
		const ctx = buildScriptContext(persona({ region: "southeast", register: "formal" }), 7);
		expect(ctx.slots.greeting).toContain("Bom dia");
	});
});

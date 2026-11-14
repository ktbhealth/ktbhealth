import { describe, expect, it } from "vitest";

import { bucketByConfidence, cer, checkEntities, normalize, wer } from "./metrics.ts";

describe("normalize", () => {
	it("lowercases, strips punctuation, collapses spaces", () => {
		expect(normalize("  Olá,  MUNDO! ")).toBe("ola mundo");
	});

	it("keeps case/punct/accents when disabled", () => {
		expect(
			normalize("Á, B", {
				lowercase: false,
				stripPunct: false,
				foldAccents: false,
				expandNumbers: false,
			}),
		).toBe("Á, B");
	});

	it("expands digits to real pt-BR numeral words", () => {
		expect(normalize("50 mg")).toBe("cinquenta mg");
		expect(normalize("7x")).toBe("sete x");
		expect(normalize("tome 2 comprimidos")).toBe("tome dois comprimidos");
	});

	it("guards decimal doses — '2,5' must never become '25'", () => {
		expect(normalize("2,5 mg")).toBe("dois virgula cinco mg");
	});

	it("guards decimal doses with a dot too — '2.5' scores like '2,5'", () => {
		expect(normalize("2.5 mg")).toBe("dois virgula cinco mg");
		expect(normalize("tome 2.5 mg de dipirona")).toBe("tome dois virgula cinco mg de dipirona");
	});

	it("strips speaker labels so labeled gold doesn't inflate WER", () => {
		expect(normalize("Doctor: como vai? Patient: bem")).toBe("como vai bem");
		expect(normalize("Paciente: dor")).toBe("dor");
	});

	it("folds accents so ASR accent slips don't count", () => {
		expect(wer("dor de cabeça", "dor de cabeca")).toBe(0);
	});
});

describe("wer / cer", () => {
	it("strips anonymization tokens so [CPF] never becomes a word (L12)", () => {
		expect(normalize("cpf [CPF] do paciente")).toBe("cpf do paciente");
		expect(normalize("ligue [PHONE] ou [EMAIL]")).toBe("ligue ou");
	});

	it("0 for identical normalized text", () => {
		expect(wer("Dor de cabeça!", "dor de cabeça")).toBe(0);
		expect(cer("Dor de cabeça!", "dor de cabeça")).toBe(0);
	});

	it("word substitutions counted", () => {
		// 4 ref words, 1 wrong → 0.25
		expect(wer("dor de cabeca forte", "dor de barriga forte")).toBe(0.25);
	});

	it("empty reference: 0 if hyp also empty, 1 otherwise", () => {
		expect(wer("", "")).toBe(0);
		expect(wer("", "algo")).toBe(1);
		expect(cer("", "")).toBe(0);
		expect(cer("", "x")).toBe(1);
	});
});

describe("checkEntities", () => {
	it("correct when the normalized entity is present, dropped otherwise", () => {
		const verdicts = checkEntities(
			[
				{ category: "medication", value: "losartana 50 mg" },
				{ category: "negation", value: "nega febre" },
			],
			"paciente toma Losartana 50 mg diário",
		);
		expect(verdicts[0]?.status).toBe("correct");
		expect(verdicts[0]?.source).toBe("text_floor");
		expect(verdicts[1]?.status).toBe("dropped");
	});

	it("never scores a negation 'correct' from the floor", () => {
		const verdicts = checkEntities(
			[{ category: "negation", value: "nega febre" }],
			"o paciente nega febre",
		);
		expect(verdicts[0]?.status).toBe("unverified");
	});

	it("matches on token boundaries — 'dor' is not inside 'dormir'", () => {
		const verdicts = checkEntities(
			[{ category: "medication", value: "dor" }],
			"o paciente vai dormir bem esta noite",
		);
		expect(verdicts[0]?.status).toBe("dropped");
	});

	it("an entity that normalizes to empty is never 'correct'", () => {
		const verdicts = checkEntities(
			[{ category: "medication", value: "!!!" }],
			"qualquer texto serve aqui",
		);
		expect(verdicts[0]?.status).toBe("dropped");
	});

	it("an empty normalized hypothesis drops every entity", () => {
		const verdicts = checkEntities([{ category: "medication", value: "losartana" }], "!!! --- ...");
		expect(verdicts[0]?.status).toBe("dropped");
	});
});

describe("bucketByConfidence", () => {
	it("groups by bucket width and computes precision", () => {
		const buckets = bucketByConfidence(
			[
				{ confidence: 0.95, correct: true },
				{ confidence: 0.97, correct: true },
				{ confidence: 0.71, correct: false },
				{ confidence: 0.72, correct: true },
				{ correct: true }, // unscored
			],
			0.1,
		);
		const b7 = buckets.find((b) => b.lo === 0.7);
		expect(b7).toMatchObject({ count: 2, correct: 1, precision: 0.5 });
		expect(buckets.at(-1)?.lo).toBe(-1); // unscored tail bucket
	});
});

describe("edge branches", () => {
	it("wer with hyp longer than ref exercises the swap", () => {
		expect(wer("oi", "oi tudo bem com voce")).toBeGreaterThan(0);
	});

	it("numbers ≥10000 fall back to digits", () => {
		expect(normalize("12345")).toBe("12345");
	});

	it("unscored bucket only renders when present", () => {
		expect(bucketByConfidence([{ confidence: 0.9, correct: true }]).at(-1)?.lo).toBe(0.9);
	});
});

describe("numberToWords branches", () => {
	it("hundreds / thousands / e-composition", () => {
		expect(normalize("100")).toBe("cem");
		expect(normalize("250")).toBe("duzentos e cinquenta");
		expect(normalize("1000")).toBe("mil");
		expect(normalize("1500")).toBe("um mil quinhentos");
		expect(normalize("1050")).toBe("um mil e cinquenta");
	});

	it("wer when ref is longer than hyp", () => {
		expect(wer("oi tudo bem com voce", "oi")).toBe(0.8);
	});
});

describe("confidence edge cases", () => {
	it("incorrect segments — scored and unscored", () => {
		const out = bucketByConfidence([
			{ confidence: 0.9, correct: false },
			{ confidence: 0.9, correct: true },
			{ correct: false },
		]);
		const scored = out.find((b) => b.lo >= 0)!;
		expect(scored.precision).toBe(0.5);
		const unscored = out.find((b) => b.lo === -1)!;
		expect(unscored.correct).toBe(0);
	});

	it("clamps negative confidence into the lowest bucket", () => {
		const out = bucketByConfidence([{ confidence: -0.5, correct: true }]);
		expect(out[0]).toMatchObject({ lo: 0, count: 1, correct: 1 });
	});

	it("non-finite confidence counts as unscored — never a NaN bucket key (M6)", () => {
		const out = bucketByConfidence([
			{ confidence: Number.NaN, correct: true },
			{ confidence: Number.POSITIVE_INFINITY, correct: false },
			{ confidence: Number.NEGATIVE_INFINITY, correct: true },
		]);
		// All three land in the lo=hi=-1 unscored bucket — no scored
		// band exists for them to hide in or escape through.
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ lo: -1, hi: -1, count: 3, correct: 2 });
	});

	it("clamps confidence=1 into the top band instead of dropping it", () => {
		const out = bucketByConfidence([{ confidence: 1, correct: true }]);
		expect(out[0]).toMatchObject({ count: 1, correct: 1 });
		expect(out[0]!.lo).toBeGreaterThanOrEqual(0.95);
	});

	it("clamps out-of-range confidence into [0,1] bands", () => {
		const out = bucketByConfidence([
			{ confidence: 1.7, correct: true },
			{ confidence: -0.5, correct: false },
		]);
		expect(out.every((b) => b.lo >= 0)).toBe(true);
		expect(out.reduce((n, b) => n + b.count, 0)).toBe(2);
	});

	it("rejects a non-positive or non-finite bucket size", () => {
		expect(() => bucketByConfidence([], 0)).toThrowError(RangeError);
		expect(() => bucketByConfidence([], -0.1)).toThrowError(RangeError);
		expect(() => bucketByConfidence([], Number.NaN)).toThrowError(RangeError);
		expect(() => bucketByConfidence([], Number.POSITIVE_INFINITY)).toThrowError(RangeError);
	});
});

describe("normalize options", () => {
	it("tens boundary and option toggles", () => {
		expect(normalize("50")).toBe("cinquenta");
		expect(normalize("53")).toBe("cinquenta e três");
		expect(normalize("200")).toBe("duzentos");
		expect(normalize("2000")).toBe("dois mil");
		expect(
			normalize("Doctor: DOR de Cabeça.", {
				lowercase: false,
				foldAccents: false,
				stripSpeakers: false,
			}),
		).toContain("Cabeça");
	});
});

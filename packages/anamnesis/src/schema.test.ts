import { Option } from "effect";
import { describe, expect, it } from "vitest";

import {
	AnamnesisReviewSchema,
	AnamnesisSchema,
	decodeAnamnesis,
	decodeAnamnesisOption,
	decodeAnamnesisReview,
	decodeAnamnesisReviewOption,
} from "./schema.ts";
import type { Anamnesis } from "./types.ts";

const section = { content: "x", confidence: "media" as const, evidence: ["ev"] };
const SAMPLE_ANAMNESIS: Anamnesis = {
	queixa_principal: section,
	hda: section,
	antecedentes: section,
	alergias: section,
	medicamentos_em_uso: section,
	exame_fisico: section,
	hipoteses: section,
	conduta: section,
};

const REVIEW = {
	lacunas: [
		{
			secao: "hda",
			o_que_falta: "duração",
			pergunta_sugerida: "Há quanto tempo?",
			motivo: "define conduta",
		},
	],
	hipoteses: [
		{
			diagnostico: "IVAS",
			probabilidade: "media",
			raciocinio: "febre + tosse",
			evidence: ["febre"],
			investigar: ["exame"],
		},
	],
	sinais_de_alerta: ["dispneia"],
	inconsistencias: [],
};

describe("anamnesis schema", () => {
	it("decodes a valid anamnesis", () => {
		expect(decodeAnamnesis(SAMPLE_ANAMNESIS)).toEqual(SAMPLE_ANAMNESIS);
	});

	it("rejects malformed anamnesis", () => {
		expect(() => decodeAnamnesis({})).toThrow();
		expect(() => decodeAnamnesis({ ...SAMPLE_ANAMNESIS, hda: { content: 1 } })).toThrow();
	});

	it("decodes a valid review", () => {
		expect(decodeAnamnesisReview(REVIEW)).toEqual(REVIEW);
	});

	it("rejects invalid review", () => {
		expect(() => decodeAnamnesisReview({ ...REVIEW, lacunas: "x" })).toThrow();
	});

	it("option decoders return None on invalid input", () => {
		expect(Option.isNone(decodeAnamnesisOption(null))).toBe(true);
		expect(Option.isSome(decodeAnamnesisOption(SAMPLE_ANAMNESIS))).toBe(true);
		expect(Option.isNone(decodeAnamnesisReviewOption({}))).toBe(true);
		expect(Option.isSome(decodeAnamnesisReviewOption(REVIEW))).toBe(true);
	});

	it("exposes the schemas for JSON-schema generation", () => {
		expect(AnamnesisSchema).toBeDefined();
		expect(AnamnesisReviewSchema).toBeDefined();
	});
});

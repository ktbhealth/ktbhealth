import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { AnamnesisSchema, decodeAnamnesis, decodeAnamnesisOption } from "./schema.ts";
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

describe("anamnesis schema", () => {
	it("decodes a valid anamnesis", () => {
		expect(decodeAnamnesis(SAMPLE_ANAMNESIS)).toEqual(SAMPLE_ANAMNESIS);
	});

	it("rejects malformed anamnesis", () => {
		expect(() => decodeAnamnesis({})).toThrow();
		expect(() => decodeAnamnesis({ ...SAMPLE_ANAMNESIS, hda: { content: 1 } })).toThrow();
	});

	it("option decoder returns None on invalid input", () => {
		expect(Option.isNone(decodeAnamnesisOption(null))).toBe(true);
		expect(Option.isSome(decodeAnamnesisOption(SAMPLE_ANAMNESIS))).toBe(true);
	});

	it("exposes the schema for JSON-schema generation", () => {
		expect(AnamnesisSchema).toBeDefined();
	});
});

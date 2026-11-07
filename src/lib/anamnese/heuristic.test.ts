import { describe, expect, it } from "vitest";

import { SAMPLE_TRANSCRIPT } from "#/lib/sample.ts";
import { HeuristicExtractor } from "./heuristic.ts";

describe("HeuristicExtractor", () => {
	it("extracts a structured anamnese from the sample transcript", async () => {
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);

		expect(a.queixa_principal.content).toMatch(/dor de cabeça/i);
		expect(a.medicamentos_em_uso.content).toMatch(/losartana/i);
		expect(a.antecedentes.content).toMatch(/hipertenso/i);
		expect(a.alergias.evidence.length).toBeGreaterThan(0);
		expect(a.exame_fisico.confidence).toBe("baixa");
	});
});

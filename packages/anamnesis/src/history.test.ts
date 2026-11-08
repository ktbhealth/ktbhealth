import { describe, expect, it } from "vitest";

import type { Anamnesis, PatientHistory } from "./types.ts";
import {
	anamnesisWithHistory,
	factContent,
	formatVisitDate,
	patientHistorySection,
	priorVisitLine,
} from "./history.ts";
import { anamnesisToText } from "./format.ts";
import { HeuristicExtractor } from "./heuristic.ts";
import { SAMPLE_TRANSCRIPT } from "./testing.ts";

const SECTION = { content: "x", confidence: "alta" as const, evidence: [] as string[] };

const ANAMNESIS: Anamnesis = {
	queixa_principal: SECTION,
	hda: SECTION,
	antecedentes: SECTION,
	alergias: SECTION,
	medicamentos_em_uso: SECTION,
	exame_fisico: SECTION,
	hipoteses: SECTION,
	conduta: SECTION,
};

const HISTORY: PatientHistory = {
	count: 2,
	visits: [
		{
			id: 12,
			date: "2026-03-05T14:30:00.000Z",
			chiefComplaint: "Dor de cabeça",
			plan: "Dipirona 1g",
		},
		{ id: 9, date: "2026-01-20T10:00:00.000Z", chiefComplaint: null, plan: null },
	],
};

describe("factContent", () => {
	it("keeps real content and drops empty/pending placeholders", () => {
		expect(factContent("Dor de cabeça")).toBe("Dor de cabeça");
		expect(factContent("  ")).toBeNull();
		expect(factContent(null)).toBeNull();
		expect(factContent(undefined)).toBeNull();
		expect(factContent("A preencher pelo médico: conduta.")).toBeNull();
	});
});

describe("formatVisitDate", () => {
	it("formats ISO dates as DD/MM/YYYY", () => {
		expect(formatVisitDate("2026-03-05T14:30:00.000Z")).toBe("05/03/2026");
	});
});

describe("priorVisitLine", () => {
	it("renders complaint and plan when present", () => {
		expect(priorVisitLine(HISTORY.visits[0]!)).toBe(
			'- 05/03/2026 (#12): queixa "Dor de cabeça"; conduta "Dipirona 1g"',
		);
	});

	it("omits missing fields and complaint-only visits", () => {
		expect(priorVisitLine(HISTORY.visits[1]!)).toBe("- 20/01/2026 (#9)");
		expect(
			priorVisitLine({
				id: 3,
				date: "2026-02-01T00:00:00.000Z",
				chiefComplaint: "Febre",
				plan: null,
			}),
		).toBe('- 01/02/2026 (#3): queixa "Febre"');
		expect(
			priorVisitLine({
				id: 4,
				date: "2026-02-02T00:00:00.000Z",
				chiefComplaint: null,
				plan: "Repouso",
			}),
		).toBe('- 02/02/2026 (#4): conduta "Repouso"');
	});
});

describe("patientHistorySection", () => {
	it("builds a factual alta-confidence section", () => {
		const sec = patientHistorySection(HISTORY);
		expect(sec?.confidence).toBe("alta");
		expect(sec?.content).toContain("Consultas anteriores (2):");
		expect(sec?.content).toContain('queixa "Dor de cabeça"');
		expect(sec?.evidence).toEqual([
			"consulta #12 · 2026-03-05T14:30:00.000Z",
			"consulta #9 · 2026-01-20T10:00:00.000Z",
		]);
	});

	it("returns null for missing or empty history", () => {
		expect(patientHistorySection(null)).toBeNull();
		expect(patientHistorySection(undefined)).toBeNull();
		expect(patientHistorySection({ count: 0, visits: [] })).toBeNull();
	});
});

describe("anamnesisWithHistory", () => {
	it("attaches historico when history exists", () => {
		const out = anamnesisWithHistory(ANAMNESIS, HISTORY);
		expect(out.historico?.content).toContain("Consultas anteriores (2):");
		expect(out.queixa_principal).toBe(ANAMNESIS.queixa_principal);
	});

	it("strips model-emitted historico when there is no history", () => {
		const withFake = { ...ANAMNESIS, historico: SECTION };
		const out = anamnesisWithHistory(withFake);
		expect(out.historico).toBeUndefined();
		expect(out.conduta).toBe(ANAMNESIS.conduta);
	});

	it("is a no-op shape-wise without history", () => {
		const out = anamnesisWithHistory(ANAMNESIS, null);
		expect(out.historico).toBeUndefined();
	});
});

describe("anamnesisToText with historico", () => {
	it("appends the prior-consultations block", async () => {
		const base = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const withHistory = anamnesisWithHistory(base, HISTORY);
		const text = anamnesisToText(withHistory);
		expect(text).toContain("PRIOR CONSULTATIONS\n");
		expect(text).toContain("Consultas anteriores (2):");
	});
});

import { describe, expect, it } from "vitest";

import { buildPrompt, PROMPT } from "./prompt.ts";

const HISTORY = {
	count: 2,
	visits: [
		{
			id: 12,
			date: "2026-03-05T14:30:00.000Z",
			chiefComplaint: "Dor de cabeça",
			plan: "Dipirona",
		},
		{ id: 9, date: "2026-01-20T10:00:00.000Z", chiefComplaint: null, plan: null },
	],
};

describe("buildPrompt", () => {
	it("returns the base prompt without history", () => {
		expect(buildPrompt()).toBe(PROMPT);
		expect(buildPrompt(null)).toBe(PROMPT);
		expect(buildPrompt({ count: 0, visits: [] })).toBe(PROMPT);
	});

	it("injects factual history lines with strict context-only framing", () => {
		const prompt = buildPrompt(HISTORY);
		expect(prompt).toContain("PATIENT HISTORY");
		expect(prompt).toContain("NOT clinical suggestions");
		expect(prompt).toContain('- 05/03/2026 (#12): queixa "Dor de cabeça"; conduta "Dipirona"');
		expect(prompt).toContain("- 20/01/2026 (#9)");
		expect(prompt).toContain("TRANSCRIPT:");
	});
});

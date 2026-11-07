import { describe, expect, it } from "vitest";

import { HeuristicExtractor } from "@ktb/anamnesis";
import { SAMPLE_TRANSCRIPT } from "@ktb/anamnesis";
import { renderAnamnesisPdf } from "./index.ts";

describe("renderAnamnesisPdf", () => {
	it("produces a valid PDF with the anamnese content", async () => {
		const anamnesis = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const pdf = await renderAnamnesisPdf({
			consultationId: 7,
			createdAt: new Date("2026-11-06T14:30:00"),
			patientName: "José da Conceição",
			doctorName: "Dra. Ana Lúcia",
			consentAt: new Date("2026-11-06T14:29:00"),
			anamnesis,
		});
		expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
		expect(pdf.length).toBeGreaterThan(1500);
		// regression: footer used to spill into extra blank pages
		const pages = pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
		expect(pages).toHaveLength(1);
		if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_OUT, pdf);
	});
});

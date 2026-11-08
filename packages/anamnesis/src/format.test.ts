import { describe, expect, it } from "vitest";

import { anamnesisToText } from "./format.ts";
import { HeuristicExtractor } from "./heuristic.ts";
import { SAMPLE_TRANSCRIPT } from "./testing.ts";

describe("anamnesisToText", () => {
	it("formats anamnesis into plain text sections", async () => {
		const anamnesis = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const text = anamnesisToText(anamnesis);
		expect(text).toContain("CHIEF COMPLAINT\n");
		expect(text).toContain("HISTORY OF PRESENT ILLNESS\n");
		expect(text).toContain(anamnesis.queixa_principal.content);
		expect(text).toContain(anamnesis.conduta.content);
	});
});

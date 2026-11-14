import { describe, expect, test } from "vitest";

import { ALL_CONTRIBUTIONS, buildRegistry } from "./contributions.ts";

describe("buildRegistry", () => {
	test("registers every declared contribution exactly once", () => {
		const registry = buildRegistry();
		expect(registry.list()).toHaveLength(ALL_CONTRIBUTIONS.length);
		// Capability + stage coverage the consult-asr suite needs.
		for (const id of ["tts", "asr", "llm", "eval", "store", "report"]) {
			expect(registry.has("capability", id)).toBe(true);
		}
		for (const id of ["synthesize", "transcribe", "script_gen", "cleanup", "judge"]) {
			expect(registry.has("stage", id)).toBe(true);
		}
		for (const id of ["wer", "cer", "entity-verdicts", "confidence-calibration", "risk-score"]) {
			expect(registry.has("metric", id)).toBe(true);
		}
		expect(registry.has("gate", "auto-accept")).toBe(true);
	});

	test("fresh registries are independent", () => {
		const a = buildRegistry();
		const b = buildRegistry();
		expect(a).not.toBe(b);
		expect(() => a.register({ kind: "stage", id: "custom", version: "1" })).not.toThrow();
		expect(b.has("stage", "custom")).toBe(false);
	});
});

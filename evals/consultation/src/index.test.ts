import { describe, expect, it } from "vitest";

import { consultContributions } from "./index.ts";

describe("eval.consultation domain pack", () => {
	it("declares the domain metrics, gate, presets and condition as a plain contribution array", () => {
		expect(consultContributions.map((c) => `${c.kind}:${c.id}`)).toEqual([
			"eval.metric:wer",
			"eval.metric:cer",
			"eval.metric:entity-verdicts",
			"eval.metric:confidence-calibration",
			"eval.metric:risk-score",
			"eval.gate:auto-accept",
			"eval.gatepreset:consult.standard",
			"eval.gatepreset:consult.strict",
			"eval.condition:wer-above",
		]);
	});

	it("every runnable contribution declares a config validator (P-078)", () => {
		for (const c of consultContributions) {
			if (c.kind === "eval.gatepreset") continue; // presets are data, not runnable
			expect(c.validateConfig, `${c.kind}:${c.id}`).toBeTypeOf("function");
		}
	});
});

import { describe, expect, it } from "vitest";

import { consultContributions } from "./index.ts";

describe("eval.consultation domain pack", () => {
	it("declares the domain metrics and auto-accept gate as a plain contribution array", () => {
		expect(consultContributions.map((c) => `${c.kind}:${c.id}`)).toEqual([
			"eval.metric:wer",
			"eval.metric:cer",
			"eval.metric:entity-verdicts",
			"eval.metric:confidence-calibration",
			"eval.metric:risk-score",
			"eval.gate:auto-accept",
		]);
	});
});

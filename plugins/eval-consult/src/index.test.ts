import { describe, expect, it } from "vitest";

import { consultContributions, plugins } from "./index.ts";

describe("eval.consult", () => {
	it("exposes a single plugin manifest carrying its contributions", () => {
		expect(plugins.map((p) => p.id)).toEqual(["eval.consult"]);
		expect(plugins[0]?.contributions).toBe(consultContributions);
	});

	it("declares the domain metrics and auto-accept gate", () => {
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

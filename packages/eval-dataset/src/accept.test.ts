import { describe, expect, it } from "vitest";

import { decideAutoAccept, gateRun, type AcceptPolicy } from "./accept.ts";
import type { SampleResult } from "./schema.ts";

const policy: AcceptPolicy = { maxWer: 0.05, target: 0.9, minN: 10, maxRisk: 2 };

const result = (over?: Partial<SampleResult>): SampleResult => ({
	runId: "r",
	sampleId: "s1",
	asrText: "t",
	asrMetrics: {
		wer: 0.03,
		cer: 0.02,
		criticalErrors: 0,
		entityVerdicts: [],
	},
	correctedMetrics: {
		wer: 0.01,
		cer: 0.01,
		criticalErrors: 0,
		entityVerdicts: [],
	},
	editVerdicts: [],
	confSegments: Array.from({ length: 50 }, () => ({ correct: true, confidence: 0.9 })),
	createdAt: 0,
	...over,
});

describe("decideAutoAccept", () => {
	it("accepts when all three gates pass (corrected stage)", () => {
		const d = decideAutoAccept(result(), policy);
		expect(d.accept).toBe(true);
		expect(d.reasons).toEqual([]);
	});

	it("rejects and names a WER breach", () => {
		const d = decideAutoAccept(
			result({ correctedMetrics: { wer: 0.2, cer: 0.1, criticalErrors: 0, entityVerdicts: [] } }),
			policy,
		);
		expect(d.accept).toBe(false);
		expect(d.reasons[0]).toContain("wer 0.200");
	});

	it("rejects on insufficient evidence even at 100% observed", () => {
		const d = decideAutoAccept(result({ confSegments: [] }), policy);
		expect(d.accept).toBe(false);
		expect(d.reasons.join()).toContain("insufficient evidence");
	});

	it("rejects on precision floor under target with enough n", () => {
		const d = decideAutoAccept(
			result({
				confSegments: Array.from({ length: 20 }, (_, i) => ({
					correct: i < 15,
					confidence: 0.9,
				})),
			}),
			policy,
		);
		expect(d.accept).toBe(false);
		expect(d.reasons.join()).toContain("precision floor");
	});

	it("rejects on severity-weighted risk over budget", () => {
		const d = decideAutoAccept(
			result({
				correctedMetrics: {
					wer: 0.01,
					cer: 0.01,
					criticalErrors: 0,
					entityVerdicts: [{ category: "negation", entity: "nega febre", status: "dropped" }],
				},
			}),
			policy,
		);
		expect(d.accept).toBe(false);
		expect(d.reasons.join()).toContain("risk score 3");
	});

	it("rejects when the selected stage has no metrics", () => {
		const d = decideAutoAccept(result({ correctedMetrics: undefined }), policy);
		expect(d.accept).toBe(false);
		expect(d.reasons[0]).toContain("no corrected metrics");
	});

	it("honors a custom confidence level z", () => {
		// z=1.0 widens the accept band vs the 1.96 default.
		const d = decideAutoAccept(
			result({
				confSegments: Array.from({ length: 30 }, (_, i) => ({
					correct: i < 28,
					confidence: 0.9,
				})),
			}),
			{ ...policy, z: 1.0, target: 0.85 },
		);
		expect(d.accept).toBe(true);
	});

	it("gates the asr stage when asked", () => {
		const d = decideAutoAccept(result(), { ...policy, stage: "asr" });
		expect(d.metrics?.wer).toBe(0.03);
	});
});

describe("gateRun", () => {
	it("green only when every sample accepts", () => {
		const g = gateRun([result(), result({ sampleId: "s2" })], policy);
		expect(g.green).toBe(true);
		expect(g.accepted).toBe(2);
	});

	it("lists every rejection with reasons", () => {
		const g = gateRun(
			[
				result(),
				result({
					sampleId: "bad",
					correctedMetrics: { wer: 0.9, cer: 0.9, criticalErrors: 0, entityVerdicts: [] },
				}),
			],
			policy,
		);
		expect(g.green).toBe(false);
		expect(g.rejected).toHaveLength(1);
		expect(g.rejected[0]?.id).toBe("bad");
	});
});

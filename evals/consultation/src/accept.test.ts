import { describe, expect, it } from "vitest";

import { decideAutoAccept, gateRun, type AcceptPolicy } from "./accept.ts";
import type { SampleResult } from "./schema.ts";

const policy: AcceptPolicy = {
	maxWer: 0.05,
	target: 0.9,
	minN: 10,
	maxRisk: 2,
	maxHarmfulEdits: 0,
	maxUnjudgedEdits: 0,
};

const cleanVerdict = {
	category: "medication" as const,
	entity: "losartana",
	status: "correct" as const,
};

const result = (over?: Partial<SampleResult>): SampleResult => ({
	runId: "r",
	sampleId: "s1",
	asrText: "t",
	asrMetrics: {
		wer: 0.03,
		cer: 0.02,
		criticalErrors: 0,
		entityVerdicts: [cleanVerdict],
	},
	correctedMetrics: {
		wer: 0.01,
		cer: 0.01,
		criticalErrors: 0,
		entityVerdicts: [cleanVerdict],
	},
	editVerdicts: [],
	confSegments: Array.from({ length: 50 }, () => ({ correct: true, confidence: 0.9 })),
	createdAt: 0,
	...over,
});

describe("decideAutoAccept", () => {
	it("accepts when every gate passes (corrected stage)", () => {
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

	it("low confidence alone does not reject — only band precision does", () => {
		// Confidence magnitude is not gated; a clean low-confidence band
		// is as acceptable as a clean high-confidence one.
		const d = decideAutoAccept(
			result({
				confSegments: Array.from({ length: 50 }, () => ({ correct: true, confidence: 0.01 })),
			}),
			policy,
		);
		expect(d.accept).toBe(true);
	});

	it("rejects errors concentrated in one confidence band the pooled floor would hide", () => {
		// 194/200 = 0.97 observed → pooled Wilson floor clears 0.90, but
		// the [0.95,1.0) band observes 0.70 — concentration must fail.
		const confSegments = [
			...Array.from({ length: 180 }, () => ({ correct: true, confidence: 0.5 })),
			...Array.from({ length: 20 }, (_, i) => ({ correct: i < 14, confidence: 0.97 })),
		];
		const d = decideAutoAccept(result({ confSegments }), policy);
		expect(d.accept).toBe(false);
		expect(d.reasons.join()).toContain("confidence band [0.95,1)");
		expect(d.reasons.join()).not.toContain("precision floor");
	});

	it("rejects a weak low-confidence band too — bands are vetoed at any height", () => {
		const confSegments = [
			...Array.from({ length: 180 }, () => ({ correct: true, confidence: 0.97 })),
			...Array.from({ length: 20 }, (_, i) => ({ correct: i < 10, confidence: 0.5 })),
		];
		const d = decideAutoAccept(result({ confSegments }), policy);
		expect(d.accept).toBe(false);
		expect(d.reasons.join()).toContain("confidence band [0.5,0.55)");
	});

	it("unscored segments skip the band check but still count in the pooled floor", () => {
		// 60 scored-clean + 40 unscored with 3 errors → pooled 97/100
		// clears the floor; the unscored bucket (lo=hi=-1) is exempt
		// from the per-band veto.
		const confSegments = [
			...Array.from({ length: 60 }, () => ({ correct: true, confidence: 0.9 })),
			...Array.from({ length: 40 }, (_, i) => ({ correct: i < 37 })),
		];
		const d = decideAutoAccept(result({ confSegments }), policy);
		expect(d.accept).toBe(true);
	});

	it("counts unscored segments the same as scored ones", () => {
		const d = decideAutoAccept(
			result({
				confSegments: Array.from({ length: 50 }, () => ({ correct: true })),
			}),
			policy,
		);
		expect(d.accept).toBe(true);
	});

	it("gates the asr stage when asked", () => {
		const d = decideAutoAccept(result(), { ...policy, stage: "asr" });
		expect(d.metrics?.wer).toBe(0.03);
	});

	it("rejects empty entityVerdicts — no clinical audit is not a clean bill (M10)", () => {
		const d = decideAutoAccept(
			result({
				correctedMetrics: { wer: 0.01, cer: 0.01, criticalErrors: 0, entityVerdicts: [] },
			}),
			policy,
		);
		expect(d.accept).toBe(false);
		expect(d.reasons.join()).toContain("no corrected entity verdicts");
	});

	it("rejects a harmful cleanup edit even when everything else is clean (M5)", () => {
		const d = decideAutoAccept(
			result({
				editVerdicts: [{ editIndex: 0, classification: "harmful" }],
			}),
			policy,
		);
		expect(d.accept).toBe(false);
		expect(d.reasons.join()).toContain("harmful edits 1 > 0");
	});

	it("rejects unjudged edits — unknown is not benign (M5)", () => {
		const d = decideAutoAccept(
			result({
				editVerdicts: [
					{ editIndex: 0, classification: "justified_fix" },
					{ editIndex: 1, classification: "unjudged" },
				],
			}),
			policy,
		);
		expect(d.accept).toBe(false);
		expect(d.reasons.join()).toContain("unjudged edits 1 > 0");
	});

	it("honors raised edit budgets", () => {
		const d = decideAutoAccept(
			result({
				editVerdicts: [
					{ editIndex: 0, classification: "harmful" },
					{ editIndex: 1, classification: "unjudged" },
				],
			}),
			{ ...policy, maxHarmfulEdits: 1, maxUnjudgedEdits: 1 },
		);
		expect(d.accept).toBe(true);
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

	it("an empty run is not green — no evidence is not a pass (M10)", () => {
		const g = gateRun([], policy);
		expect(g.green).toBe(false);
		expect(g.accepted).toBe(0);
		expect(g.rejected).toEqual([]);
	});
});

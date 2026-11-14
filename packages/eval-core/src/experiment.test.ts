import { describe, expect, test } from "vitest";
import { Schema } from "effect";

import {
	CalibrationReport,
	diffExperiments,
	DatasetManifest,
	Experiment,
	renderCalibrationMarkdown,
	renderExperimentCompareMarkdown,
} from "./index.ts";

const exp = (over: Partial<Experiment> = {}): Experiment => ({
	id: "run-1",
	kind: "run",
	suiteId: "s1",
	manifestHash: "h1",
	gitSha: "abc",
	profile: "stub",
	dataset: { id: "d", version: "v1" },
	startedAt: 1,
	finishedAt: 2,
	summary: { meanWer: 0.1, ok: 3 },
	gates: [{ id: "auto-accept", green: true, accepted: 3, total: 3 }],
	...over,
});

describe("diffExperiments", () => {
	test("identity + summary + gate rows", () => {
		const a = exp();
		const b = exp({
			id: "run-2",
			kind: "generate",
			gitSha: undefined,
			profile: "local",
			dataset: { id: "d", version: "v2" },
			startedAt: 5,
			summary: { meanWer: 0.2, ok: 4, extra: "x", nested: { deep: 1 }, nil: null },
			gates: [{ id: "auto-accept", green: false, accepted: 1, total: 4 }],
		});
		const d = diffExperiments(a, b);
		const byField = new Map(d.rows.map((r) => [r.field, r]));
		expect(byField.get("kind")).toMatchObject({ a: "run", b: "generate", changed: true });
		expect(byField.get("suite")).toMatchObject({ a: "s1", b: "s1", changed: false });
		expect(byField.get("dataset")).toMatchObject({ a: "d@v1", b: "d@v2" });
		expect(byField.get("profile")).toMatchObject({ a: "stub", b: "local" });
		expect(byField.get("gitSha")).toMatchObject({ a: "abc", b: "-", changed: true });
		expect(byField.get("summary.meanWer")).toMatchObject({
			a: "0.1",
			b: "0.2",
			delta: expect.closeTo(0.1),
			changed: true,
		});
		expect(byField.get("summary.ok")).toMatchObject({ delta: 1 });
		expect(byField.get("summary.extra")).toMatchObject({ a: "-", b: "x" });
		expect(byField.get("summary.nested")).toMatchObject({ a: "-", b: '{"deep":1}' });
		expect(byField.get("summary.nil")).toMatchObject({ a: "-", b: "-", changed: false });
		expect(byField.get("gate.auto-accept")).toMatchObject({
			a: "GREEN 3/3",
			b: "RED 1/4",
			changed: true,
		});
	});

	test("missing gates on one side render as '-'", () => {
		const d1 = diffExperiments(exp({ gates: undefined }), exp());
		expect(d1.rows.find((r) => r.field === "gate.auto-accept")).toMatchObject({
			a: "-",
			b: "GREEN 3/3",
			changed: true,
		});
		const d2 = diffExperiments(exp(), exp({ gates: undefined }));
		expect(d2.rows.find((r) => r.field === "gate.auto-accept")).toMatchObject({
			a: "GREEN 3/3",
			b: "-",
			changed: true,
		});
		// RED gate on side A covers the green:false render branch.
		const d3 = diffExperiments(
			exp({ gates: [{ id: "auto-accept", green: false, accepted: 0, total: 2 }] }),
			exp({ gates: undefined }),
		);
		expect(d3.rows.find((r) => r.field === "gate.auto-accept")).toMatchObject({
			a: "RED 0/2",
			b: "-",
		});
	});

	test("derivedFrom lineage renders as a joined diff row (P-077)", () => {
		const d = diffExperiments(
			exp({ derivedFrom: ["run-a", "run-b"] }),
			exp({ derivedFrom: ["run-c"] }),
		);
		expect(d.rows.find((r) => r.field === "derivedFrom")).toMatchObject({
			a: "run-a,run-b",
			b: "run-c",
			changed: true,
		});
		const both = diffExperiments(exp({ derivedFrom: ["r"] }), exp({ derivedFrom: ["r"] }));
		expect(both.rows.find((r) => r.field === "derivedFrom")?.changed).toBe(false);
	});

	test("non-numeric summary values have no delta", () => {
		const d = diffExperiments(
			exp({ summary: { stages: "a,b" } }),
			exp({ summary: { stages: "a,c" } }),
		);
		const row = d.rows.find((r) => r.field === "summary.stages");
		expect(row?.delta).toBeUndefined();
		expect(row?.changed).toBe(true);
	});
});

describe("renderExperimentCompareMarkdown", () => {
	test("renders the diff table and escapes pipes", () => {
		const md = renderExperimentCompareMarkdown(
			diffExperiments(exp({ profile: "a|b" }), exp({ id: "run-2" })),
		);
		expect(md).toContain("# experiment compare");
		expect(md).toContain("`run-1`");
		expect(md).toContain("`run-2`");
		expect(md).toContain("a\\|b");
		expect(md).toContain("| field | A | B | delta |");
		expect(md).toContain("| summary.ok | 3 | 3 | 0 |");
	});
});

describe("renderCalibrationMarkdown", () => {
	const report = (over: Partial<CalibrationReport> = {}): CalibrationReport => ({
		id: "cal-1",
		suiteId: "s1",
		dataset: { id: "d", version: "v1" },
		runId: "run-1",
		createdAt: 1,
		samples: 2,
		questions: 10,
		agreements: 8,
		agreementRate: 0.8,
		lowerBound: 0.49,
		kinds: [{ kind: "noul", n: 10, agreements: 8, agreementRate: 0.8 }],
		buckets: [
			{ lo: 0.9, hi: 0.95, count: 4, agreements: 4, agreementRate: 1 },
			{ lo: -1, hi: -1, count: 6, agreements: 4, agreementRate: 4 / 6 },
		],
		judges: [{ engine: "jev" }, { engine: "systemone", model: "m1" }],
		...over,
	});

	test("full report", () => {
		const md = renderCalibrationMarkdown(report());
		expect(md).toContain("# judge calibration — s1");
		expect(md).toContain("run run-1");
		expect(md).toContain("80.0%");
		expect(md).toContain("49.0%");
		expect(md).toContain("jev, systemone/m1");
		expect(md).toContain("| noul | 10 | 8 | 80.0% |");
		expect(md).toContain("| [0.9, 0.95) | 4 | 4 | 100.0% |");
		expect(md).toContain("| unscored | 6 | 4 | 66.7% |");
	});

	test("empty judges, no runId, zero questions", () => {
		const md = renderCalibrationMarkdown(
			report({
				runId: undefined,
				questions: 0,
				agreements: 0,
				agreementRate: 0,
				lowerBound: 0,
				kinds: [],
				buckets: [],
				judges: [],
			}),
		);
		expect(md).not.toContain("run run-1");
		expect(md).toContain("judges: none recorded");
		expect(md).toContain("rate -");
	});
});

describe("artifact schemas", () => {
	test("Experiment/DatasetManifest/CalibrationReport decode + reject", () => {
		const decodeExp = Schema.decodeUnknownSync(Experiment);
		expect(decodeExp(exp()).id).toBe("run-1");
		expect(() => decodeExp({ id: "x" })).toThrow(Schema.SchemaError);
		expect(() => decodeExp(exp({ kind: "bogus" as never }))).toThrow(Schema.SchemaError);

		const decodeDs = Schema.decodeUnknownSync(DatasetManifest);
		const ds = {
			id: "d",
			version: "v1",
			domain: "dom",
			generator: { seed: 1 },
			createdAt: 1,
			sampleCount: 3,
			contentHash: "abc",
		};
		expect(decodeDs(ds).sampleCount).toBe(3);
		expect(() => decodeDs({ ...ds, sampleCount: "x" })).toThrow(Schema.SchemaError);

		const decodeCal = Schema.decodeUnknownSync(CalibrationReport);
		const calDoc = {
			id: "c1",
			suiteId: "s",
			dataset: { id: "d", version: "v" },
			createdAt: 1,
			samples: 0,
			questions: 0,
			agreements: 0,
			agreementRate: 0,
			lowerBound: 0,
			kinds: [],
			buckets: [],
			judges: [],
		};
		expect(decodeCal(calDoc).id).toBe("c1");
		expect(() => decodeCal({ ...calDoc, questions: "x" })).toThrow(Schema.SchemaError);
	});
});

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defineSuite, stageIdOf, stageIdsOf, stageNodesOf, validateManifest } from "./suite.ts";

const valid = {
	id: "demo-cleanup",
	domain: "eval.dom.demo",
	dataset: { id: "demo-synth", version: "2026-01" },
	stages: ["asr", "cleanup", "judge"],
	caps: { asr: "cap.alpha", tts: "cap.beta" },
	metrics: ["wer", "cer", "entities"],
	gates: [{ id: "auto-accept", params: { target: 0.9, minN: 50 } }],
	schemaVersion: 1,
	adapterProfile: "stub",
};

describe("defineSuite", () => {
	it("decodes a valid manifest", () => {
		const m = defineSuite(valid);
		expect(m.id).toBe("demo-cleanup");
		expect(m.domain).toBe("eval.dom.demo");
		expect(m.dataset).toEqual({ id: "demo-synth", version: "2026-01" });
		expect(m.stages).toEqual(["asr", "cleanup", "judge"]);
		expect(m.caps).toEqual({ asr: "cap.alpha", tts: "cap.beta" });
		expect(m.metrics).toEqual(["wer", "cer", "entities"]);
		expect(m.gates).toEqual([{ id: "auto-accept", params: { target: 0.9, minN: 50 } }]);
		expect(m.schemaVersion).toBe(1);
		expect(m.adapterProfile).toBe("stub");
	});

	it("adapterProfile and gate params are optional", () => {
		const { adapterProfile: _a, gates: _g, ...rest } = valid;
		const m = defineSuite({ ...rest, gates: [{ id: "auto-accept" }] });
		expect(m.adapterProfile).toBeUndefined();
		expect(m.gates[0]?.params).toBeUndefined();
	});

	it("rejects non-data input — missing fields", () => {
		expect(() => defineSuite({ id: "x" })).toThrowError(Schema.SchemaError);
		expect(() => defineSuite(null)).toThrowError(Schema.SchemaError);
		expect(() => defineSuite("suite")).toThrowError(Schema.SchemaError);
	});

	it("rejects inline functions — contributions are referenced by id only", () => {
		expect(() => defineSuite({ ...valid, stages: [() => "asr"] })).toThrowError(Schema.SchemaError);
		expect(() => defineSuite({ ...valid, metrics: ["wer", () => 1] })).toThrowError(
			Schema.SchemaError,
		);
	});

	it("rejects non-JSON gate params — no closures in params", () => {
		expect(() =>
			defineSuite({
				...valid,
				gates: [{ id: "g", params: { run: () => 1 } }],
			}),
		).toThrowError(Schema.SchemaError);
	});

	it("rejects non-string caps values", () => {
		expect(() => defineSuite({ ...valid, caps: { asr: 42 } })).toThrowError(Schema.SchemaError);
	});

	it("accepts DAG node entries and cross-suite inputs (P-077)", () => {
		const m = defineSuite({
			...valid,
			stages: [
				"asr",
				{ id: "cleanup", needs: ["asr"], optional: true },
				{ id: "judge", needs: [], when: { condition: "auto", params: { k: 1 } } },
			],
			inputs: [
				{ suite: "upstream", stage: "transcribe", field: "asrText" },
				{ suite: "other", runId: "run-1", datasetVersion: "v9" },
			],
		});
		expect(m.stages[1]).toEqual({ id: "cleanup", needs: ["asr"], optional: true });
		expect(m.stages[2]).toEqual({
			id: "judge",
			needs: [],
			when: { condition: "auto", params: { k: 1 } },
		});
		expect(m.inputs).toHaveLength(2);
	});

	it("rejects malformed stage nodes and input refs", () => {
		expect(() => defineSuite({ ...valid, stages: [{ needs: [] }] })).toThrowError(
			Schema.SchemaError,
		);
		expect(() => defineSuite({ ...valid, stages: [{ id: "x", needs: "y" }] })).toThrowError(
			Schema.SchemaError,
		);
		expect(() =>
			defineSuite({
				...valid,
				stages: [{ id: "x", when: { condition: "c", params: { f: () => 1 } } }],
			}),
		).toThrowError(Schema.SchemaError);
		expect(() => defineSuite({ ...valid, inputs: [{ stage: "s" }] })).toThrowError(
			Schema.SchemaError,
		);
	});
});

describe("stage entry helpers", () => {
	it("stageIdOf/stageIdsOf/stageNodesOf normalize mixed entries", () => {
		const entries: readonly import("./suite.ts").StageEntry[] = ["a", { id: "b", needs: [] }];
		expect(stageIdOf("a")).toBe("a");
		expect(stageIdOf(entries[1])).toBe("b");
		expect(stageIdsOf(entries)).toEqual(["a", "b"]);
		expect(stageNodesOf(entries)).toEqual([{ id: "a" }, { id: "b", needs: [] }]);
	});
});

describe("validateManifest", () => {
	it("returns the decoded manifest for valid input", () => {
		expect(validateManifest(valid)).toEqual(defineSuite(valid));
	});

	it("returns null for invalid input", () => {
		expect(validateManifest({ id: "x" })).toBeNull();
		expect(validateManifest(undefined)).toBeNull();
		expect(validateManifest(42)).toBeNull();
	});
});

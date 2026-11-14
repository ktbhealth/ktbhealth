import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defineSuite, validateManifest } from "./suite.ts";

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

import { describe, expect, test } from "vitest";

import type { Plugin } from "@ktb/kernel";

import {
	ALL_CONTRIBUTIONS,
	buildRegistry,
	collectEvalContributions,
	evalPlugins,
} from "./contributions.ts";

describe("buildRegistry", () => {
	test("registers every declared contribution exactly once", () => {
		const registry = buildRegistry();
		expect(registry.list()).toHaveLength(ALL_CONTRIBUTIONS.length);
		// Capability + stage coverage the consult-asr suite needs.
		for (const id of ["tts", "asr", "llm", "eval", "store", "report"]) {
			expect(registry.has("eval.capability", id)).toBe(true);
		}
		for (const id of ["synthesize", "transcribe", "script_gen", "cleanup", "judge"]) {
			expect(registry.has("eval.stage", id)).toBe(true);
		}
		for (const id of ["wer", "cer", "entity-verdicts", "confidence-calibration", "risk-score"]) {
			expect(registry.has("eval.metric", id)).toBe(true);
		}
		expect(registry.has("eval.gate", "auto-accept")).toBe(true);
	});

	test("fresh registries are independent", () => {
		const a = buildRegistry();
		const b = buildRegistry();
		expect(a).not.toBe(b);
		expect(() => a.register({ kind: "eval.stage", id: "custom", version: "1" })).not.toThrow();
		expect(b.has("eval.stage", "custom")).toBe(false);
	});
});

describe("evalPlugins", () => {
	test("discovers the five eval plugin manifests in topo order", () => {
		expect(evalPlugins.map((p) => p.id)).toEqual([
			"transcription.tts",
			"transcription.asr",
			"llm.eval",
			"storage.dataset",
			"eval.consult",
		]);
	});
});

describe("collectEvalContributions", () => {
	test("collects eval.* entries off plugin manifests", () => {
		const plugins: readonly Plugin[] = [
			{
				id: "x.eval",
				contributions: [
					{ kind: "eval.stage", id: "s1", version: "1" },
					{ kind: "eval.capability", id: "c1", version: "2", meta: { port: "p" } },
				],
			},
			{ id: "x.bare" },
		];
		expect(collectEvalContributions(plugins)).toEqual([
			{ kind: "eval.stage", id: "s1", version: "1", meta: undefined },
			{ kind: "eval.capability", id: "c1", version: "2", meta: { port: "p" } },
		]);
	});

	test("throws on a contribution kind the consumer does not know", () => {
		const plugins: readonly Plugin[] = [
			{
				id: "x.eval",
				contributions: [{ kind: "telemetry.span", id: "t", version: "1" }],
			},
		];
		expect(() => collectEvalContributions(plugins)).toThrow(
			/unregistered contribution kind "telemetry.span"/,
		);
	});
});

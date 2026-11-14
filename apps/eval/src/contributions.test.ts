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
		// P-078: gate presets, domain condition, builtin conditions.
		expect(registry.has("eval.gatepreset", "consult.standard")).toBe(true);
		expect(registry.has("eval.gatepreset", "consult.strict")).toBe(true);
		expect(registry.has("eval.condition", "wer-above")).toBe(true);
		for (const id of ["nonempty", "always", "never"]) {
			expect(registry.has("eval.condition", id)).toBe(true);
		}
		// Domain contributions carry config validators; capability
		// plugin contributions do not (yet).
		expect(registry.configValidator("eval.gate", "auto-accept")).toBeTypeOf("function");
		expect(registry.configValidator("eval.stage", "judge")).toBeUndefined();
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
	test("discovers the four capability plugin manifests in topo order", () => {
		// Domain packs are not plugins (P-075) — eval.consult dissolved
		// into evals/consultation and contributes via consultContributions.
		expect(evalPlugins.map((p) => p.id)).toEqual([
			"transcription.tts",
			"transcription.asr",
			"llm.eval",
			"storage.dataset",
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

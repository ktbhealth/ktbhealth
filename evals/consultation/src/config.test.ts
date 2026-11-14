import { describe, expect, it } from "vitest";

import type { ConfigValidation } from "@ktb/eval-core";

import {
	ConfidenceCalibrationConfig,
	consultConditions,
	decodeAutoAcceptConfig,
	EntityVerdictsConfig,
	NormalizeConfig,
	policyNumberError,
	POLICY_FIELDS,
	RiskScoreConfig,
	schemaConfigValidator,
	validateAutoAcceptConfig,
	WerAboveConfig,
} from "./config.ts";
import { ptBR } from "./locales/pt-BR.ts";

/** Narrowing helpers — expect() inside an `if` trips
 * vitest/no-conditional-expect, so failures are extracted by throw. */
const successOf = (r: ReturnType<typeof decodeAutoAcceptConfig>) => {
	if (r._tag !== "Success") throw new Error(`expected success, got failure: ${r.failure}`);
	return r.success;
};

const failureOf = (r: ReturnType<typeof decodeAutoAcceptConfig>): string => {
	if (r._tag !== "Failure") throw new Error("expected failure, got success");
	return r.failure;
};

const errorOf = (v: ConfigValidation): string => {
	if (v.ok) throw new Error("expected validation failure, got success");
	return v.error;
};

describe("schemaConfigValidator", () => {
	it("decodes valid config and rejects unknown keys", () => {
		const v = schemaConfigValidator(NormalizeConfig);
		expect(v(undefined)).toEqual({ ok: true, config: {} });
		expect(v({ lowercase: false, profile: ptBR.id })).toEqual({
			ok: true,
			config: { lowercase: false, profile: ptBR.id },
		});
		expect(v({ lowercase: "yes" }).ok).toBe(false);
		const unknown = v({ bogus: 1 });
		expect(unknown.ok).toBe(false);
		expect(errorOf(unknown)).toContain("bogus");
	});

	it("rejects non-object config", () => {
		const v = schemaConfigValidator(RiskScoreConfig);
		expect(v("x").ok).toBe(false);
		expect(v([1]).ok).toBe(false);
	});
});

describe("NormalizeConfig", () => {
	it("accepts the NormalizeOpts toggles and the registered profile id", () => {
		const v = schemaConfigValidator(NormalizeConfig);
		expect(
			v({
				lowercase: true,
				stripPunct: false,
				expandNumbers: true,
				foldAccents: true,
				stripSpeakers: true,
				profile: ptBR.id,
			}).ok,
		).toBe(true);
	});

	it("rejects an unknown locale profile", () => {
		const v = schemaConfigValidator(NormalizeConfig);
		const r = v({ profile: "en-US" });
		expect(r.ok).toBe(false);
		expect(errorOf(r)).toContain("en-US");
	});
});

describe("EntityVerdictsConfig", () => {
	it("accepts stage asr|corrected only", () => {
		const v = schemaConfigValidator(EntityVerdictsConfig);
		expect(v({ stage: "corrected" }).ok).toBe(true);
		expect(v({ stage: "raw" }).ok).toBe(false);
	});
});

describe("ConfidenceCalibrationConfig", () => {
	it("requires a finite positive bucketSize when present", () => {
		const v = schemaConfigValidator(ConfidenceCalibrationConfig);
		expect(v({ bucketSize: 0.1 }).ok).toBe(true);
		expect(v({ bucketSize: 0 }).ok).toBe(false);
		expect(v({ bucketSize: Number.NaN }).ok).toBe(false);
	});
});

describe("RiskScoreConfig", () => {
	it("takes no config keys", () => {
		const v = schemaConfigValidator(RiskScoreConfig);
		expect(v(undefined)).toEqual({ ok: true, config: {} });
		expect(v({ weight: 2 }).ok).toBe(false);
	});
});

describe("WerAboveConfig", () => {
	it("requires a finite threshold; key is optional", () => {
		const v = schemaConfigValidator(WerAboveConfig);
		expect(v(undefined).ok).toBe(false);
		expect(v({}).ok).toBe(false);
		expect(v({ threshold: 0.2 }).ok).toBe(true);
		expect(v({ threshold: 0.2, key: "transcribe" }).ok).toBe(true);
		expect(v({ threshold: Number.POSITIVE_INFINITY }).ok).toBe(false);
		expect(v({ threshold: 0.1, bogus: 1 }).ok).toBe(false);
	});
});

describe("decodeAutoAcceptConfig", () => {
	it("defaults match the auto-accept gate policy", () => {
		expect(successOf(decodeAutoAcceptConfig(undefined))).toEqual({
			stage: "corrected",
			maxWer: 0.05,
			target: 0.9,
			minN: 40,
			maxRisk: 0,
			maxHarmfulEdits: 0,
			maxUnjudgedEdits: 0,
		});
	});

	it("reads a full config object", () => {
		expect(
			successOf(
				decodeAutoAcceptConfig({
					stage: "asr",
					maxWer: 0.1,
					target: 0.95,
					minN: 80,
					maxRisk: 2,
					maxHarmfulEdits: 1,
					maxUnjudgedEdits: 3,
					z: 1.5,
				}),
			),
		).toEqual({
			stage: "asr",
			maxWer: 0.1,
			target: 0.95,
			minN: 80,
			maxRisk: 2,
			maxHarmfulEdits: 1,
			maxUnjudgedEdits: 3,
			z: 1.5,
		});
	});

	it("rejects non-object config", () => {
		expect(failureOf(decodeAutoAcceptConfig("x"))).toBe("config must be a JSON object");
		expect(decodeAutoAcceptConfig([1])._tag).toBe("Failure");
	});

	it("rejects unknown keys, nulls, bad stage and bad ranges", () => {
		expect(decodeAutoAcceptConfig({ bogus: 1 })._tag).toBe("Failure");
		expect(failureOf(decodeAutoAcceptConfig({ bogus: 1 }))).toContain('unknown config key "bogus"');
		expect(failureOf(decodeAutoAcceptConfig({ maxWer: null }))).toBe(
			"config.maxWer must not be null",
		);
		expect(failureOf(decodeAutoAcceptConfig({ stage: "raw" }))).toBe(
			'config.stage must be "asr" or "corrected"',
		);
		for (const [cfg, msg] of [
			[{ maxWer: "high" }, "config.maxWer must be a finite number"],
			[{ minN: 2.5 }, "config.minN must be an integer >= 0"],
			[{ minN: -1 }, "config.minN must be an integer >= 0"],
			[{ z: Number.NaN }, "config.z must be a finite number"],
			[{ z: 0 }, "config.z must be > 0"],
			[{ maxWer: -0.1 }, "config.maxWer must be >= 0"],
			[{ maxRisk: -1 }, "config.maxRisk must be >= 0"],
			[{ maxHarmfulEdits: -1 }, "config.maxHarmfulEdits must be >= 0"],
			[{ maxUnjudgedEdits: -1 }, "config.maxUnjudgedEdits must be >= 0"],
			[{ target: 1.5 }, "config.target must be in [0, 1]"],
		] as const) {
			const r = decodeAutoAcceptConfig(cfg);
			expect(r._tag).toBe("Failure");
			expect(failureOf(r)).toBe(msg);
		}
	});
});

describe("validateAutoAcceptConfig", () => {
	it("maps the decoder Result onto ConfigValidation", () => {
		const ok = validateAutoAcceptConfig({ target: 0.8 });
		expect(ok.ok).toBe(true);
		const bad = validateAutoAcceptConfig({ target: 9 });
		expect(bad.ok).toBe(false);
		expect(errorOf(bad)).toContain("config.target");
	});
});

describe("policyNumberError", () => {
	it("keeps the AcceptPolicy range rules (shared with CLI overrides)", () => {
		expect(POLICY_FIELDS).toContain("maxWer");
		expect(policyNumberError("target", 0.5)).toBeNull();
		expect(policyNumberError("target", 2)).toBe("must be in [0, 1]");
		expect(policyNumberError("unknown-field", -1)).toBeNull();
	});
});

describe("consultConditions wer-above (P-078)", () => {
	const outputs = new Map<string, unknown>([
		["transcribe", { wer: 0.4 }],
		["cleanup", { wer: 0.1 }],
	]);

	it("is true when the keyed output's WER exceeds the threshold", () => {
		const eval_ = consultConditions["wer-above"]!;
		expect(eval_({ params: { threshold: 0.3, key: "transcribe" }, outputs })).toBe(true);
		expect(eval_({ params: { threshold: 0.5, key: "transcribe" }, outputs })).toBe(false);
	});

	it("falls back to the first output carrying a WER when key is absent", () => {
		const eval_ = consultConditions["wer-above"]!;
		expect(eval_({ params: { threshold: 0.05 }, outputs })).toBe(true);
	});

	it("reads WER nested inside stage-metric records", () => {
		const eval_ = consultConditions["wer-above"]!;
		const nested = new Map<string, unknown>([
			["transcribe", { asrMetrics: { wer: 0.5, stage: "asr" } }],
			["cleanup", { correctedMetrics: { wer: 0.02 } }],
		]);
		expect(eval_({ params: { threshold: 0.4 }, outputs: nested })).toBe(true);
		expect(eval_({ params: { threshold: 0.6 }, outputs: nested })).toBe(false);
	});

	it("is false on missing/invalid params or no WER-bearing output", () => {
		const eval_ = consultConditions["wer-above"]!;
		expect(eval_({ params: {}, outputs })).toBe(false);
		expect(eval_({ params: { threshold: "x" }, outputs })).toBe(false);
		// Outputs exist but none carries a WER — scanned and skipped.
		expect(eval_({ params: { threshold: 0.1 }, outputs: new Map([["x", { foo: 1 }]]) })).toBe(
			false,
		);
		// A keyed output that does not exist resolves to no WER.
		expect(eval_({ params: { threshold: 0.1, key: "ghost" }, outputs })).toBe(false);
	});
});

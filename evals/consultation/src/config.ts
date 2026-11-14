import * as Result from "effect/Result";
import { Schema } from "effect";

import type { ConfigValidator, ConditionEvaluator } from "@ktb/eval-core";

import type { AcceptPolicy } from "./accept.ts";
import { ptBR } from "./locales/pt-BR.ts";

/**
 * config.ts — contribution-declared config schemas + validators
 * (P-078).
 *
 * Manifests stay pure data; the config SHAPES live here with the
 * domain code that consumes them. Each `consultContributions` entry
 * carries a `validateConfig` built from the helpers below — apps/eval
 * runs it at `eval list`/`eval run` resolution. Validators are
 * effect/Schema decodes with `onExcessProperty: "error"`: unknown
 * config keys are REJECTED so a typo'd manifest cannot silently
 * no-op. `undefined` config decodes as `{}` — absent config means
 * "domain defaults", never an error (unless the schema requires a
 * field, like `wer-above`'s threshold).
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Wrap an effect/Schema as a contribution `ConfigValidator`.
 * Decodes `config ?? {}` strictly (excess keys rejected) and maps
 * the SchemaError message into the validation failure. */
export const schemaConfigValidator =
	<S extends Schema.ConstraintDecoder<unknown>>(schema: S): ConfigValidator =>
	(config) => {
		const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: "error" })(config ?? {});
		if (Result.isSuccess(decoded)) {
			return { ok: true, config: decoded.success };
		}
		return { ok: false, error: decoded.failure.message };
	};

const Bool = Schema.optionalKey(Schema.Boolean);

/** `NormalizeOpts`-shaped config shared by the `wer`/`cer` metrics
 * (metrics.ts) — every field optional, defaults live in
 * `normalize()`'s DEFAULT_OPTS. `profile` is a LocaleProfile id;
 * pt-BR (`ptbr-v1`) is the only registered profile today. */
export const NormalizeConfig = Schema.Struct({
	lowercase: Bool,
	stripPunct: Bool,
	expandNumbers: Bool,
	foldAccents: Bool,
	stripSpeakers: Bool,
	profile: Schema.optionalKey(
		Schema.String.check(
			Schema.makeFilter(
				(p) => p === ptBR.id || `unknown locale profile "${p}" (known: ${ptBR.id})`,
			),
		),
	),
});
export type NormalizeConfig = typeof NormalizeConfig.Type;

/** `entity-verdicts` metric config — which stage's entity audit the
 * metric describes (mirrors the contribution's `meta.stage`). */
export const EntityVerdictsConfig = Schema.Struct({
	stage: Schema.optionalKey(Schema.Literals(["asr", "corrected"])),
});
export type EntityVerdictsConfig = typeof EntityVerdictsConfig.Type;

/** `confidence-calibration` metric config — `bucketByConfidence`'s
 * bucket width (metrics.ts: finite, > 0). */
export const ConfidenceCalibrationConfig = Schema.Struct({
	bucketSize: Schema.optionalKey(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
});
export type ConfidenceCalibrationConfig = typeof ConfidenceCalibrationConfig.Type;

/** `risk-score` takes no config — any key is rejected. A `Struct({})`
 * would decode ANY value (zero declared fields short-circuit the
 * object check), so the "empty object" shape is a string-keyed
 * record whose values must be `never`. */
export const RiskScoreConfig = Schema.Record(Schema.String, Schema.Never);

/** `wer-above` condition params (P-078): `threshold` is required —
 * a WER guard without a cutoff is meaningless. `key` names the prior
 * stage output to read (same convention as builtin `nonempty`);
 * absent, the first output carrying a WER wins. */
export const WerAboveConfig = Schema.Struct({
	threshold: Schema.Number.check(Schema.isFinite()),
	key: Schema.optionalKey(Schema.String),
});
export type WerAboveConfig = typeof WerAboveConfig.Type;

// ---------- auto-accept gate config ----------

/** AcceptPolicy field names — the only keys a gate `config`/`params`
 * object may carry. Single source for manifest validation AND the
 * CLI flag overrides in apps/eval (policy.ts). */
export const POLICY_FIELDS = [
	"stage",
	"maxWer",
	"target",
	"minN",
	"maxRisk",
	"maxHarmfulEdits",
	"maxUnjudgedEdits",
	"z",
] as const;

/** Range rules for every numeric AcceptPolicy field — shared by
 * manifest config (decodeAutoAcceptConfig) and CLI flag overrides
 * (apps/eval commands/gate.ts). A gate that out-of-range numbers can
 * weaken (negative z collapsing the Wilson bound, target > 1,
 * negative error budgets) is not a gate: every entry point rejects
 * them. */
export const policyNumberError = (field: string, v: number): string | null => {
	switch (field) {
		case "target":
			return v >= 0 && v <= 1 ? null : "must be in [0, 1]";
		case "minN":
			return Number.isInteger(v) && v >= 0 ? null : "must be an integer >= 0";
		case "z":
			// z <= 0 degenerates the Wilson lower bound — it would
			// silently weaken the precision gate, so it must be > 0.
			return v > 0 ? null : "must be > 0";
		case "maxWer":
		case "maxRisk":
		case "maxHarmfulEdits":
		case "maxUnjudgedEdits":
			return v >= 0 ? null : "must be >= 0";
		default:
			return null;
	}
};

const numField = (
	c: Record<string, unknown>,
	key: string,
	def: number,
): Result.Result<number, string> => {
	const v = c[key] ?? def;
	if (typeof v !== "number" || !Number.isFinite(v)) {
		return Result.fail(`config.${key} must be a finite number`);
	}
	return Result.succeed(v);
};

/** numField + range rule — the decoded value or a failure reason. */
const rangedField = (
	c: Record<string, unknown>,
	key: string,
	def: number,
): Result.Result<number, string> => {
	const n = numField(c, key, def);
	if (Result.isFailure(n)) return n;
	const err = policyNumberError(key, n.success);
	if (err !== null) {
		return Result.fail(`config.${key} ${err}`);
	}
	return n;
};

/**
 * Decode an `auto-accept` gate `config` into an AcceptPolicy — the
 * contribution-owned config decoder (P-078). Unknown keys are
 * rejected — a typo'd config must not silently no-op. Explicit JSON
 * `null` is NOT "absent" — `?? default` would silently substitute
 * the default and weaken the gate; null is malformed data.
 */
export const decodeAutoAcceptConfig = (config: unknown): Result.Result<AcceptPolicy, string> => {
	if (config !== undefined && !isRecord(config)) {
		return Result.fail("config must be a JSON object");
	}
	const c = (config ?? {}) as Record<string, unknown>;
	for (const [key, v] of Object.entries(c)) {
		if (!(POLICY_FIELDS as readonly string[]).includes(key)) {
			return Result.fail(`unknown config key "${key}" (known: ${POLICY_FIELDS.join(", ")})`);
		}
		if (v === null) {
			return Result.fail(`config.${key} must not be null`);
		}
	}
	const stage = c.stage ?? "corrected";
	if (stage !== "asr" && stage !== "corrected") {
		return Result.fail(`config.stage must be "asr" or "corrected"`);
	}
	const maxWer = rangedField(c, "maxWer", 0.05);
	if (Result.isFailure(maxWer)) return Result.fail(maxWer.failure);
	const target = rangedField(c, "target", 0.9);
	if (Result.isFailure(target)) return Result.fail(target.failure);
	const minN = rangedField(c, "minN", 40);
	if (Result.isFailure(minN)) return Result.fail(minN.failure);
	const maxRisk = rangedField(c, "maxRisk", 0);
	if (Result.isFailure(maxRisk)) return Result.fail(maxRisk.failure);
	const maxHarmfulEdits = rangedField(c, "maxHarmfulEdits", 0);
	if (Result.isFailure(maxHarmfulEdits)) return Result.fail(maxHarmfulEdits.failure);
	const maxUnjudgedEdits = rangedField(c, "maxUnjudgedEdits", 0);
	if (Result.isFailure(maxUnjudgedEdits)) return Result.fail(maxUnjudgedEdits.failure);
	const z = c.z;
	if (z !== undefined) {
		if (typeof z !== "number" || !Number.isFinite(z)) {
			return Result.fail("config.z must be a finite number");
		}
		const err = policyNumberError("z", z);
		if (err !== null) {
			return Result.fail(`config.z ${err}`);
		}
	}
	return Result.succeed({
		stage,
		maxWer: maxWer.success,
		target: target.success,
		minN: minN.success,
		maxRisk: maxRisk.success,
		maxHarmfulEdits: maxHarmfulEdits.success,
		maxUnjudgedEdits: maxUnjudgedEdits.success,
		...(z !== undefined ? { z: z as number } : {}),
	});
};

/** `validateConfig` for the `auto-accept` gate contribution — same
 * decode as `eval gate` consumes, surfaced as a ConfigValidation. */
export const validateAutoAcceptConfig: ConfigValidator = (config) => {
	const r = decodeAutoAcceptConfig(config);
	return Result.isSuccess(r) ? { ok: true, config: r.success } : { ok: false, error: r.failure };
};

// ---------- contributed conditions (P-078) ----------

/** First numeric `wer` found on a stage output — tolerates
 * `{wer}`, `{asrMetrics|correctedMetrics: {wer}}`, and nested metric
 * records, since stage outputs are domain-defined. */
const werOf = (v: unknown): number | undefined => {
	if (!isRecord(v)) return undefined;
	if (typeof v.wer === "number" && Number.isFinite(v.wer)) return v.wer;
	for (const inner of Object.values(v)) {
		if (isRecord(inner) && typeof inner.wer === "number" && Number.isFinite(inner.wer)) {
			return inner.wer;
		}
	}
	return undefined;
};

/**
 * Domain condition evaluators for `runStageGraph`'s `conditions`
 * map (dag.ts) — registered under the ids `consultContributions`
 * declares as `eval.condition`. `wer-above` reads the WER of a prior
 * stage's output (`params.key`, or the first output carrying one)
 * and is true when it EXCEEDS `params.threshold` — e.g. gate a
 * cleanup stage on "only when ASR was bad".
 */
export const consultConditions: Readonly<Record<string, ConditionEvaluator<unknown>>> = {
	"wer-above": ({ params, outputs }) => {
		const threshold = params?.threshold;
		if (typeof threshold !== "number" || !Number.isFinite(threshold)) return false;
		const key = params?.key;
		const candidates = typeof key === "string" ? [outputs.get(key)] : [...outputs.values()];
		for (const v of candidates) {
			const w = werOf(v);
			if (w !== undefined) return w > threshold;
		}
		return false;
	},
};

/**
 * accept.ts — auto-accept decision (M3).
 *
 * Whether a sample's output may skip physician review is a POLICY
 * call, computed from evidence — never a model confidence claim.
 * Three independent gates, all must pass, every failure named:
 *
 *   1. lexical: stage WER under maxWer
 *   2. calibration: Wilson-floor precision over confSegments
 *      ≥ target AND n ≥ minN (small samples can't auto-accept)
 *   3. risk: severity-weighted entity misses ≤ maxRisk
 *
 * Pure — the caller picks the stage ("asr" gates the raw transcript,
 * "corrected" gates post-cleanup, the default).
 */

import { calibrate } from "./calibrate.ts";
import { riskScore } from "./negation.ts";
import type { SampleResult, StageMetrics } from "./schema.ts";

export interface AcceptPolicy {
	readonly stage?: "asr" | "corrected";
	readonly maxWer: number;
	readonly target: number;
	readonly minN: number;
	readonly maxRisk: number;
	readonly z?: number;
}

export interface AcceptDecision {
	readonly accept: boolean;
	readonly stage: "asr" | "corrected";
	readonly reasons: readonly string[];
	readonly metrics?: StageMetrics;
}

export const decideAutoAccept = (result: SampleResult, policy: AcceptPolicy): AcceptDecision => {
	const stage = policy.stage ?? "corrected";
	const metrics = stage === "asr" ? result.asrMetrics : result.correctedMetrics;
	const reasons: string[] = [];

	if (metrics === undefined) {
		return { accept: false, stage, reasons: [`no ${stage} metrics recorded`] };
	}
	if (metrics.wer > policy.maxWer) {
		reasons.push(`wer ${metrics.wer.toFixed(3)} > ${policy.maxWer}`);
	}

	const cal = calibrate(result.confSegments, {
		target: policy.target,
		minN: policy.minN,
		...(policy.z !== undefined ? { z: policy.z } : {}),
	});
	if (!cal.passes) {
		reasons.push(
			cal.n < policy.minN
				? `insufficient evidence: n=${cal.n} < minN=${policy.minN}`
				: `precision floor ${cal.lowerBound.toFixed(3)} < ${policy.target}`,
		);
	}

	const risk = riskScore(metrics.entityVerdicts);
	if (risk > policy.maxRisk) {
		reasons.push(`risk score ${risk} > ${policy.maxRisk}`);
	}

	return { accept: reasons.length === 0, stage, reasons, metrics };
};

/** Aggregate gate over a whole run — the CI hook reads this. A run is
 * only "green" when EVERY sample passes AND the cohort calibration
 * passes at aggregate level. */
export const gateRun = (
	results: readonly SampleResult[],
	policy: AcceptPolicy,
): {
	readonly green: boolean;
	readonly accepted: number;
	readonly rejected: readonly { id: string; reasons: readonly string[] }[];
} => {
	const rejected = results.flatMap((r) => {
		const d = decideAutoAccept(r, policy);
		return d.accept ? [] : [{ id: r.sampleId, reasons: d.reasons }];
	});
	return { green: rejected.length === 0, accepted: results.length - rejected.length, rejected };
};

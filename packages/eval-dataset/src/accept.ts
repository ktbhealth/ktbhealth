/**
 * accept.ts — auto-accept decision (M3).
 *
 * Whether a sample's output may skip physician review is a POLICY
 * call, computed from evidence — never a model confidence claim.
 * Three independent gates, all must pass, every failure named:
 *
 *   1. lexical: stage WER under maxWer
 *   2. calibration: Wilson-floor precision over ALL confSegments
 *      ≥ target AND n ≥ minN (small samples can't auto-accept).
 *      This is a POOLED PRECISION FLOOR over judged segments — not
 *      confidence calibration. Segment `confidence` is intentionally
 *      unused at this stage (TODO: the calibration milestone — sweep
 *      `recommendAutoThreshold`/`bucketByConfidence` in metrics.ts
 *      and/or stage-scoped confSegments, see pipeline.ts).
 *   3. risk: severity-weighted entity misses ≤ maxRisk
 *
 * Pure — the caller picks the stage ("asr" gates the raw transcript,
 * "corrected" gates post-cleanup, the default).
 *
 * Evidence scope: `result.confSegments` is produced from the ASR
 * stage's segments today (see pipeline.ts), so the calibration gate
 * measures ASR-derived correctness regardless of `stage`. Stage-scoped
 * confSegments is future work; until then treat `stage` as selecting
 * WHICH metric gates, not which evidence calibrates.
 *
 * Two "auto-accept" notions coexist on purpose: this gate is a
 * run/sample-level precision floor (`calibrate` in calibrate.ts);
 * `recommendThreshold` in metrics.ts picks a per-segment confidence
 * cutoff — a different question, do not conflate them.
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
 * "green" only when EVERY sample passes: one unsafe sample sinks the
 * run, which is the intent — a large clean cohort must never mask a
 * bad tail. */
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

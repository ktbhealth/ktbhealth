/**
 * accept.ts — auto-accept decision (M3).
 *
 * Whether a sample's output may skip physician review is a POLICY
 * call, computed from evidence — never a model confidence claim.
 * Five independent gates, all must pass, every failure named:
 *
 *   1. lexical: stage WER under maxWer
 *   2. calibration: Wilson-floor precision over ALL confSegments
 *      ≥ target AND n ≥ minN (small samples can't auto-accept),
 *      PLUS every scored confidence band must itself observe
 *      precision ≥ target (`bucketByConfidence`). The pooled floor
 *      alone lets a bad high-confidence band hide inside the
 *      average — bands make concentration visible. Unscored segments
 *      (no confidence, or a non-finite one — see metrics.ts) have no
 *      confidence claim to violate: they stay governed by the pooled
 *      floor only (the lo=hi=-1 bucket).
 *   3. risk: severity-weighted entity misses ≤ maxRisk
 *   4. entities: the gated stage must carry ≥1 entity verdict —
 *      zero verdicts means the clinical audit never ran, which is
 *      insufficient evidence, not a clean bill (M10)
 *   5. edits: cleanup edits judged `harmful` ≤ maxHarmfulEdits and
 *      edits with NO judge answer (`unjudged`) ≤ maxUnjudgedEdits —
 *      an unjudged edit is never silently benign (M5)
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
 * `decideAutoAccept`/`gateRun` are the ONLY auto-accept entry points.
 * The per-segment threshold sweeps (`recommendThreshold`,
 * `recommendAutoThreshold`) were removed as dead code — if a
 * "which segments may skip review" question ever needs answering it
 * gets designed against `bucketByConfidence`, not resurrected.
 */

import { calibrate } from "@ktb/eval-core";

import { bucketByConfidence } from "./metrics.ts";
import { riskScore } from "./negation.ts";
import type { SampleResult, StageMetrics } from "./schema.ts";

export interface AcceptPolicy {
	readonly stage?: "asr" | "corrected";
	readonly maxWer: number;
	readonly target: number;
	readonly minN: number;
	readonly maxRisk: number;
	/** Max cleanup edits the judge classified `harmful`. 0 = any
	 * harmful edit sinks the sample. */
	readonly maxHarmfulEdits: number;
	/** Max cleanup edits with no judge verdict (`unjudged`). An
	 * unjudged edit is unknown, not benign — the default-safe value
	 * is 0. */
	readonly maxUnjudgedEdits: number;
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

	// Per-band floor: observed precision inside each scored confidence
	// band must itself clear target — the pooled floor is a weighted
	// mean, so a concentrated bad band (e.g. errors at high confidence)
	// can hide under it. Bands use observed precision, not a Wilson
	// bound: bands are thin by construction, and the pooled verdict
	// already carries the statistical floor. The unscored bucket
	// (lo=hi=-1) is excluded — no confidence claim to violate.
	const weakBands = bucketByConfidence(result.confSegments).filter(
		(b) => b.lo >= 0 && b.precision < policy.target,
	);
	for (const b of weakBands) {
		reasons.push(
			`confidence band [${b.lo},${b.hi}) precision ${b.precision.toFixed(3)} < ${policy.target} (n=${b.count})`,
		);
	}

	const risk = riskScore(metrics.entityVerdicts);
	if (risk > policy.maxRisk) {
		reasons.push(`risk score ${risk} > ${policy.maxRisk}`);
	}

	// Entity-evidence gate (M10): an empty verdict list means the
	// clinical audit produced nothing — WER + calibration alone cannot
	// prove a transcript preserves negations/dosages. Insufficient
	// evidence, not a clean bill.
	if (metrics.entityVerdicts.length === 0) {
		reasons.push(`no ${stage} entity verdicts — clinical audit missing`);
	}

	// Edit-audit gate (M5): the cleanup's reversibility is only as
	// good as its judge coverage. `harmful` edits corrupt clinical
	// text; `unjudged` edits were never checked at all.
	const harmful = result.editVerdicts.filter((v) => v.classification === "harmful").length;
	if (harmful > policy.maxHarmfulEdits) {
		reasons.push(`harmful edits ${harmful} > ${policy.maxHarmfulEdits}`);
	}
	const unjudged = result.editVerdicts.filter((v) => v.classification === "unjudged").length;
	if (unjudged > policy.maxUnjudgedEdits) {
		reasons.push(`unjudged edits ${unjudged} > ${policy.maxUnjudgedEdits}`);
	}

	return { accept: reasons.length === 0, stage, reasons, metrics };
};

/** Aggregate gate over a whole run — the CI hook reads this. A run is
 * "green" only when it contains ≥1 sample AND every sample passes:
 * one unsafe sample sinks the run, which is the intent — a large
 * clean cohort must never mask a bad tail, and an EMPTY run is not
 * evidence of anything (M10). */
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
	return {
		green: results.length > 0 && rejected.length === 0,
		accepted: results.length - rejected.length,
		rejected,
	};
};

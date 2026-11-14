/**
 * calibrate.ts — precision-first threshold calibration (M2/M3).
 *
 * The eval must PROVE precision before auto-accepting: a point
 * estimate over 30 samples can be 95% and still fail at scale. Wilson
 * lower bound turns "observed 96% on n=40" into a guaranteed floor —
 * auto-accept only when the floor clears the target AND n clears minN.
 * Pure statistics — no I/O.
 */

import type { ConfSegment } from "./schema.ts";

/** Wilson score lower bound — the conservative floor of the true
 * precision at confidence `z` (default 1.96 ≈ 95% CI). */
export const wilsonLowerBound = (successes: number, n: number, z = 1.96): number => {
	if (n === 0) {
		return 0;
	}
	const p = successes / n;
	const z2 = z * z;
	const center = p + z2 / (2 * n);
	const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
	return Math.max(0, (center - margin) / (1 + z2 / n));
};

export interface CalibrationVerdict {
	readonly n: number;
	readonly successes: number;
	readonly precision: number;
	/** Guaranteed floor at the given CI. */
	readonly lowerBound: number;
	/** True only when lowerBound ≥ target AND n ≥ minN. */
	readonly passes: boolean;
}

/** Pooled precision floor over judged segments — `confidence` is NOT
 * read here (this is not confidence calibration; see the domain
 * pack's gate for how this verdict combines with the
 * per-band veto). */
export const calibrate = (
	segments: readonly ConfSegment[],
	opts: { readonly target: number; readonly minN: number; readonly z?: number },
): CalibrationVerdict => {
	const n = segments.length;
	const successes = segments.filter((s) => s.correct).length;
	const lowerBound = wilsonLowerBound(successes, n, opts.z);
	return {
		n,
		successes,
		precision: n === 0 ? 0 : successes / n,
		lowerBound,
		passes: n >= opts.minN && lowerBound >= opts.target,
	};
};

// NOTE: the per-segment threshold sweep (`recommendAutoThreshold`)
// was removed — no callers. Auto-accept is a sample/run-level policy
// decision (`decideAutoAccept`/`gateRun` in the domain pack), not a
// per-segment cutoff.

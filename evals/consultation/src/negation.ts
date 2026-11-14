/**
 * negation.ts — clinical severity model for entity errors (M2).
 *
 * Not all drops are equal: losing "não tenho alergia" (negation) or a
 * dosage changes meaning dangerously; losing a filler word is noise.
 * Severity weights turn EntityVerdict counts into a risk score the
 * gate can threshold — a weighted miss beats a flat count.
 */

import type { ClinicalCategory, EntityVerdict } from "./schema.ts";

export type Severity = "critical" | "major" | "minor";

/** Per-category clinical severity — driven by harm if the entity is
 * lost or flipped, not by frequency. */
export const SEVERITY: Record<ClinicalCategory, Severity> = {
	negation: "critical",
	medication: "critical",
	dosage: "major",
	frequency: "major",
	unit: "minor",
	date: "minor",
};

const WEIGHT: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

export const severityOf = (category: ClinicalCategory): Severity => SEVERITY[category];

/** Risk score for a set of verdicts: each non-"correct" entity costs
 * its category weight. Zero = flawless. */
export const riskScore = (verdicts: readonly EntityVerdict[]): number =>
	verdicts
		.filter((v) => v.status !== "correct")
		.reduce((sum, v) => sum + WEIGHT[SEVERITY[v.category]], 0);

export const countBySeverity = (verdicts: readonly EntityVerdict[]): Record<Severity, number> => {
	const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0 };
	for (const v of verdicts) {
		if (v.status !== "correct") {
			counts[SEVERITY[v.category]]++;
		}
	}
	return counts;
};

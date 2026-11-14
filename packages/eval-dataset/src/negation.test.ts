import { describe, expect, it } from "vitest";

import { countBySeverity, riskScore, severityOf } from "./negation.ts";
import type { EntityVerdict } from "./schema.ts";

const v = (
	category: EntityVerdict["category"],
	status: EntityVerdict["status"],
): EntityVerdict => ({
	category,
	entity: "x",
	status,
});

describe("severity model", () => {
	it("negation and medication are critical; unit/date are minor", () => {
		expect(severityOf("negation")).toBe("critical");
		expect(severityOf("medication")).toBe("critical");
		expect(severityOf("dosage")).toBe("major");
		expect(severityOf("frequency")).toBe("major");
		expect(severityOf("unit")).toBe("minor");
		expect(severityOf("date")).toBe("minor");
	});

	it("riskScore weights failed entities by severity, ignores correct", () => {
		const verdicts = [
			v("negation", "dropped"),
			v("dosage", "substituted"),
			v("unit", "dropped"),
			v("medication", "correct"),
		];
		expect(riskScore(verdicts)).toBe(3 + 2 + 1);
		expect(riskScore([])).toBe(0);
		expect(riskScore([v("medication", "correct")])).toBe(0);
	});

	it("countBySeverity buckets non-correct verdicts", () => {
		const counts = countBySeverity([
			v("negation", "invented"),
			v("medication", "dropped"),
			v("dosage", "dropped"),
			v("date", "dropped"),
			v("unit", "correct"),
		]);
		expect(counts).toEqual({ critical: 2, major: 1, minor: 1 });
	});
});

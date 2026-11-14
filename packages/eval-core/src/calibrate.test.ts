import { describe, expect, it } from "vitest";

import { calibrate, recommendAutoThreshold, wilsonLowerBound } from "./calibrate.ts";

const segs = (correct: number, wrong: number, conf = 0.9) => [
	...Array.from({ length: correct }, () => ({ correct: true, confidence: conf })),
	...Array.from({ length: wrong }, () => ({ correct: false, confidence: conf })),
];

describe("wilsonLowerBound", () => {
	it("is 0 for empty input", () => {
		expect(wilsonLowerBound(0, 0)).toBe(0);
	});

	it("floor is below the point estimate — small n pays the price", () => {
		// 19/20 = 95% observed but the floor is ~75% — can't claim 95%.
		expect(wilsonLowerBound(19, 20)).toBeLessThan(0.95);
		// Same ratio at n=2000 has a much tighter floor.
		expect(wilsonLowerBound(1900, 2000)).toBeGreaterThan(0.93);
	});

	it("is monotonic in successes", () => {
		expect(wilsonLowerBound(10, 100)).toBeLessThan(wilsonLowerBound(50, 100));
	});
});

describe("calibrate", () => {
	it("passes only when floor ≥ target AND n ≥ minN", () => {
		expect(calibrate(segs(190, 10), { target: 0.9, minN: 100 }).passes).toBe(true);
		// Same observed precision, too few samples → fail.
		expect(calibrate(segs(19, 1), { target: 0.9, minN: 100 }).passes).toBe(false);
		// Enough n, floor under target → fail.
		expect(calibrate(segs(80, 20), { target: 0.9, minN: 50 }).passes).toBe(false);
	});

	it("reports precision/lowerBound honestly on empty input", () => {
		const v = calibrate([], { target: 0.9, minN: 1 });
		expect(v.precision).toBe(0);
		expect(v.lowerBound).toBe(0);
		expect(v.passes).toBe(false);
	});
});

describe("recommendAutoThreshold", () => {
	it("picks the loosest threshold that still passes", () => {
		const segments = [
			...Array.from({ length: 90 }, () => ({ correct: true, confidence: 0.9 })),
			...Array.from({ length: 10 }, () => ({ correct: false, confidence: 0.55 })),
			...Array.from({ length: 50 }, () => ({ correct: true, confidence: 0.6 })),
		];
		const r = recommendAutoThreshold(segments, { target: 0.9, minN: 50 });
		expect(r.threshold).toBe(0.6); // drops the wrong low-conf ones, keeps enough n
		expect(r.verdicts).toHaveLength(8);
	});

	it("treats missing confidence as 0 — untagged segments never sneak in", () => {
		const segments = [
			...Array.from({ length: 60 }, () => ({ correct: true, confidence: 0.9 })),
			{ correct: true }, // no confidence — counts at threshold 0 only
		];
		const r = recommendAutoThreshold(segments, { target: 0.9, minN: 50 });
		const atZero = r.verdicts.find((v) => v.threshold === 0);
		expect(atZero?.n).toBe(61);
		const atHalf = r.verdicts.find((v) => v.threshold === 0.5);
		expect(atHalf?.n).toBe(60);
	});

	it("returns null when nothing passes", () => {
		const r = recommendAutoThreshold(segs(5, 95, 0.9), { target: 0.9, minN: 50 });
		expect(r.threshold).toBeNull();
	});
});

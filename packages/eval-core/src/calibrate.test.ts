import { describe, expect, it } from "vitest";

import { calibrate, wilsonLowerBound } from "./calibrate.ts";

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

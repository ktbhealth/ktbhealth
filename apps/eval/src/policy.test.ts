import { describe, expect, test } from "vitest";

import { GATE_DECODERS, decodeAcceptPolicy } from "./policy.ts";
import { UsageError } from "./args.ts";

describe("decodeAcceptPolicy", () => {
	test("defaults match the eval-gate.ts policy", () => {
		expect(decodeAcceptPolicy(undefined)).toEqual({
			stage: "corrected",
			maxWer: 0.05,
			target: 0.9,
			minN: 40,
			maxRisk: 0,
			maxHarmfulEdits: 0,
			maxUnjudgedEdits: 0,
		});
	});

	test("reads a full params object", () => {
		const p = decodeAcceptPolicy({
			stage: "asr",
			maxWer: 0.1,
			target: 0.95,
			minN: 80,
			maxRisk: 2,
			maxHarmfulEdits: 1,
			maxUnjudgedEdits: 3,
			z: 1.5,
		});
		expect(p).toEqual({
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

	test("rejects non-object params", () => {
		expect(() => decodeAcceptPolicy("x")).toThrow(UsageError);
		expect(() => decodeAcceptPolicy([1])).toThrow(/JSON object/);
	});

	test("rejects unknown params keys", () => {
		expect(() => decodeAcceptPolicy({ bogus: 1 })).toThrow(/unknown params key/);
	});

	test("rejects bad stage", () => {
		expect(() => decodeAcceptPolicy({ stage: "raw" })).toThrow(/stage/);
	});

	test("rejects non-finite and non-integer numbers", () => {
		expect(() => decodeAcceptPolicy({ maxWer: "high" })).toThrow(/finite number/);
		expect(() => decodeAcceptPolicy({ minN: 2.5 })).toThrow(/integer/);
		expect(() => decodeAcceptPolicy({ minN: -1 })).toThrow(/>= 0/);
		expect(() => decodeAcceptPolicy({ z: Number.NaN })).toThrow(/finite number/);
	});
});

test("GATE_DECODERS registers auto-accept", () => {
	expect(GATE_DECODERS["auto-accept"]).toBe(decodeAcceptPolicy);
});

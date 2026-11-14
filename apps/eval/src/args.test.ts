import { describe, expect, test } from "vitest";

import { boolFlag, intFlag, numFlag, parseArgs, strFlag, UsageError } from "./args.ts";

const SPEC = {
	positionals: ["suite"],
	flags: {
		profile: "string",
		n: "int",
		seed: "number",
		enforce: "boolean",
	},
} as const;

describe("parseArgs", () => {
	test("parses positionals, --flag value, --flag=value and booleans", () => {
		const a = parseArgs(
			["consult-asr", "--profile", "stub", "--n=3", "--seed", "1.5", "--enforce"],
			SPEC,
		);
		expect(a.positional.suite).toBe("consult-asr");
		expect(a.flags.profile).toBe("stub");
		expect(a.flags.n).toBe(3);
		expect(a.flags.seed).toBe(1.5);
		expect(a.flags.enforce).toBe(true);
	});

	test("missing positional is a UsageError", () => {
		expect(() => parseArgs([], SPEC)).toThrow(UsageError);
		expect(() => parseArgs([], SPEC)).toThrow(/missing positional/);
	});

	test("extra positional is a UsageError", () => {
		expect(() => parseArgs(["a", "b"], SPEC)).toThrow(/unexpected argument/);
	});

	test("unknown long flag is a UsageError", () => {
		expect(() => parseArgs(["a", "--bogus"], SPEC)).toThrow(/unknown flag/);
	});

	test("unknown short arg is a UsageError", () => {
		expect(() => parseArgs(["a", "-x"], SPEC)).toThrow(/unknown argument/);
	});

	test("lone dash is a positional", () => {
		const a = parseArgs(["-"], { positionals: ["x"] });
		expect(a.positional.x).toBe("-");
	});

	test("flag requiring a value rejects end-of-argv and next-flag", () => {
		expect(() => parseArgs(["a", "--profile"], SPEC)).toThrow(/requires a value/);
		expect(() => parseArgs(["a", "--profile", "--n", "1"], SPEC)).toThrow(/requires a value/);
	});

	test("int flag rejects non-integers (M9: no silent NaN)", () => {
		expect(() => parseArgs(["a", "--n", "2.5"], SPEC)).toThrow(/integer/);
		expect(() => parseArgs(["a", "--n", "abc"], SPEC)).toThrow(/integer/);
	});

	test("number flag rejects non-finite values", () => {
		expect(() => parseArgs(["a", "--seed", "NaN"], SPEC)).toThrow(/finite/);
		expect(() => parseArgs(["a", "--seed", "Infinity"], SPEC)).toThrow(/finite/);
	});

	test("boolean flag rejects an explicit value", () => {
		expect(() => parseArgs(["a", "--enforce=true"], SPEC)).toThrow(/boolean flag/);
	});
});

describe("flag readers", () => {
	test("strFlag/intFlag/numFlag/boolFlag read typed values", () => {
		const a = parseArgs(
			["s", "--profile", "local", "--n", "4", "--seed", "0.5", "--enforce"],
			SPEC,
		);
		expect(strFlag(a, "profile")).toBe("local");
		expect(strFlag(a, "missing", "d")).toBe("d");
		expect(strFlag(a, "nothere")).toBeUndefined();
		expect(intFlag(a, "n", 1)).toBe(4);
		expect(intFlag(a, "absent", 7, 1)).toBe(7);
		expect(numFlag(a, "seed", 0)).toBe(0.5);
		expect(numFlag(a, "absent", 3)).toBe(3);
		expect(boolFlag(a, "enforce")).toBe(true);
		expect(boolFlag(a, "absent")).toBe(false);
	});

	test("intFlag enforces minimum", () => {
		const a = parseArgs(["s", "--n", "0"], SPEC);
		expect(() => intFlag(a, "n", 1, 1)).toThrow(/>= 1/);
	});

	test("readers reject kind mismatches", () => {
		const a = parseArgs(["s", "--n", "4"], SPEC);
		expect(() => strFlag(a, "n")).toThrow(/must be a string/);
		const b = parseArgs(["s", "--profile", "x"], SPEC);
		expect(() => intFlag(b, "profile", 0)).toThrow(/must be an integer/);
		expect(() => numFlag(b, "profile", 0)).toThrow(/must be a finite number/);
	});
});

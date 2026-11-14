import { describe, expect, it } from "vitest";

import {
	applyEdits,
	diffTexts,
	EditApplyError,
	emptyEditList,
	invertEdits,
	revertEdits,
	type EditOp,
} from "./diff.ts";

describe("applyEdits", () => {
	it("splices a single op", () => {
		const ops: EditOp[] = [{ at: 4, remove: "abc", insert: "XYZ", kind: "fix" }];
		expect(applyEdits("foo abc bar", ops)).toBe("foo XYZ bar");
	});

	it("applies multiple ops independently of order", () => {
		const ops: EditOp[] = [
			{ at: 0, remove: "foo", insert: "one", kind: "fix" },
			{ at: 8, remove: "baz", insert: "three", kind: "fix" },
		];
		expect(applyEdits("foo bar baz", ops)).toBe("one bar three");
	});

	it("supports pure insertion and pure deletion", () => {
		expect(applyEdits("ab", [{ at: 2, remove: "", insert: "c", kind: "fix" }])).toBe("abc");
		expect(applyEdits("abc", [{ at: 2, remove: "c", insert: "", kind: "fix" }])).toBe("ab");
	});
});

describe("invertEdits / revertEdits", () => {
	it("invert swaps remove/insert", () => {
		const [inv] = invertEdits([{ at: 0, remove: "a", insert: "b", kind: "fix" }]);
		expect(inv).toMatchObject({ remove: "b", insert: "a" });
	});

	it("revert restores the base text", () => {
		const base = "o paciente nega alergia e toma losartana 50 mg";
		const ops = diffTexts(base, "o paciente tem alergia e toma losartana 25 mg").ops;
		const edited = applyEdits(base, ops);
		expect(revertEdits(edited, ops)).toBe(base);
	});
});

describe("diffTexts", () => {
	it("empty diff for identical texts", () => {
		expect(diffTexts("same text", "same text")).toEqual(emptyEditList);
		expect(diffTexts("", "")).toEqual(emptyEditList);
	});

	it("substitution mid-text", () => {
		const { ops } = diffTexts("dor de cabeca forte", "dor de cabeça forte");
		expect(applyEdits("dor de cabeca forte", ops)).toBe("dor de cabeça forte");
	});

	it("insertion at start, middle and end", () => {
		expect(applyEdits("b c", diffTexts("b c", "a b c").ops)).toBe("a b c");
		expect(applyEdits("a c", diffTexts("a c", "a b c").ops)).toBe("a b c");
		expect(applyEdits("a b", diffTexts("a b", "a b c").ops)).toBe("a b c");
	});

	it("deletion mid-text and at end", () => {
		expect(applyEdits("a x b c", diffTexts("a x b c", "a b c").ops)).toBe("a b c");
		expect(applyEdits("a b c", diffTexts("a b c", "a b").ops)).toBe("a b");
	});

	it("multi-word replacement run", () => {
		expect(applyEdits("a x z b", diffTexts("a x z b", "a y b").ops)).toBe("a y b");
	});

	it("completely different texts", () => {
		expect(applyEdits("aaa bbb", diffTexts("aaa bbb", "ccc ddd").ops)).toBe("ccc ddd");
	});

	it("round-trips a realistic corrupted transcript", () => {
		const gold = "Paciente relata dor há três dias e nega febre.";
		const asr = "paciente relata dor a tres dias e nega febre";
		expect(applyEdits(gold, diffTexts(gold, asr).ops)).toBe(asr);
	});
});

describe("integrity guard", () => {
	it("throws EditApplyError when remove does not match the base", () => {
		expect(() =>
			applyEdits("o que você está sentindo dor de cabeca", [
				{ at: 29, remove: "cabeca", insert: "cabeça", kind: "fix" },
			]),
		).toThrowError(EditApplyError);
	});

	it("pure insertions (empty remove) always match", () => {
		expect(applyEdits("ab", [{ at: 1, remove: "", insert: "X", kind: "fix" }])).toBe("aXb");
	});
});

describe("property", () => {
	it("applyEdits(base, diffTexts(base, target)) === target on varied inputs", () => {
		const words = ["paciente", "nega", "febre", "toma", "losartana", "mg", "dor", "há"];
		const rng = (seed: number) => () =>
			(seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		const rand = rng(42);
		for (let i = 0; i < 50; i++) {
			const mk = () =>
				Array.from(
					{ length: 1 + Math.floor(rand() * 30) },
					() => words[Math.floor(rand() * 8)],
				).join(" ");
			const base = mk();
			const target = mk();
			expect(applyEdits(base, diffTexts(base, target).ops)).toBe(target);
			expect(revertEdits(target, diffTexts(base, target).ops)).toBe(base);
		}
	});

	it("caps the DP table on divergent inputs — one whole-range replace", () => {
		// 2100×2000 tokens > 4M cells → memory guard fires.
		const base = Array.from({ length: 2100 }, (_, i) => `a${i}`).join(" ");
		const target = Array.from({ length: 2000 }, (_, i) => `b${i}`).join(" ");
		const { ops } = diffTexts(base, target);
		expect(ops).toHaveLength(1);
		expect(applyEdits(base, ops)).toBe(target);
	});
});

import { describe, expect, it } from "vitest";

import { applyEdits, EditApplyError, type EditOp } from "./diff.ts";

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

	it("applies a realistic flagged entity edit", () => {
		const ops: EditOp[] = [
			{ at: 7, remove: "cabeca", insert: "cabeça", kind: "entity", flagged: true },
		];
		expect(applyEdits("dor de cabeca forte", ops)).toBe("dor de cabeça forte");
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

import { describe, expect, it } from "vitest";

import type { PluginContribution } from "@ktb/kernel";

import { EVAL_CONTRIBUTION_KINDS, isEvalContributionKind, toEvalContribution } from "./kinds.ts";

describe("EVAL_CONTRIBUTION_KINDS", () => {
	it("declares the five eval kinds on the generic contributions slot", () => {
		expect(EVAL_CONTRIBUTION_KINDS.map((k) => k.id)).toEqual([
			"eval.stage",
			"eval.metric",
			"eval.gate",
			"eval.condition",
			"eval.capability",
		]);
		for (const kind of EVAL_CONTRIBUTION_KINDS) {
			expect(kind.slot).toBe("contributions");
			expect(kind.consumers).toEqual(["eval-cli"]);
			expect(kind.ordering).toBe("declared");
		}
	});
});

describe("isEvalContributionKind", () => {
	it("accepts eval kinds and rejects others", () => {
		expect(isEvalContributionKind("eval.stage")).toBe(true);
		expect(isEvalContributionKind("eval.condition")).toBe(true);
		expect(isEvalContributionKind("eval.capability")).toBe(true);
		expect(isEvalContributionKind("stage")).toBe(false);
		expect(isEvalContributionKind("pages")).toBe(false);
	});
});

describe("toEvalContribution", () => {
	const entry = (over: Partial<PluginContribution> = {}): PluginContribution => ({
		kind: "eval.stage",
		id: "s1",
		version: "1",
		...over,
	});

	it("narrows a matching entry to a Contribution", () => {
		const c = toEvalContribution(entry({ meta: { port: "p" } }));
		expect(c).toEqual({ kind: "eval.stage", id: "s1", version: "1", meta: { port: "p" } });
	});

	it("returns undefined for non-eval kinds", () => {
		expect(toEvalContribution(entry({ kind: "pages" }))).toBeUndefined();
	});

	it("throws when an eval entry is missing its version", () => {
		const { version: _v, ...noVersion } = entry();
		expect(() => toEvalContribution(noVersion)).toThrow(/missing a version/);
	});
});

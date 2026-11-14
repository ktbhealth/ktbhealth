import { describe, expect, it } from "vitest";

import type { Plugin } from "./contributions.ts";
import {
	collectContributions,
	collectKindContributions,
	FIELD_CONTRIBUTION_KINDS,
	GENERIC_CONTRIBUTION_SLOT,
	pluginContributionKinds,
	type ContributionKindDescriptor,
} from "./kinds.ts";

const pagesKind = FIELD_CONTRIBUTION_KINDS.find((k) => k.id === "pages")!;
const evalStageKind: ContributionKindDescriptor = {
	id: "eval.stage",
	slot: GENERIC_CONTRIBUTION_SLOT,
	consumers: ["eval-cli"],
	ordering: "declared",
};

describe("FIELD_CONTRIBUTION_KINDS", () => {
	it("declares one descriptor per dedicated Plugin field", () => {
		expect(FIELD_CONTRIBUTION_KINDS.map((k) => k.id)).toEqual([
			"tables",
			"services",
			"routes",
			"landing",
			"chrome",
			"panel",
			"pages",
		]);
		for (const kind of FIELD_CONTRIBUTION_KINDS) {
			expect(kind.slot).toBe(kind.id);
			expect(kind.consumers.length).toBeGreaterThan(0);
		}
	});
});

describe("collectKindContributions", () => {
	const plugins: readonly Plugin[] = [
		{
			id: "a.pages",
			pages: [
				{ id: "a.one", path: "/one", component: () => null },
				{ id: "a.two", path: "/two", component: () => null },
			],
		},
		{ id: "b.marker" },
		{
			id: "c.pages",
			pages: [{ id: "c.one", path: "/c", component: () => null }],
		},
	];

	it("fans out over array fields in plugin then declaration order", () => {
		const collected = collectKindContributions(plugins, pagesKind);
		expect(collected.map((c) => [c.plugin.id, c.entryIndex])).toEqual([
			["a.pages", 0],
			["a.pages", 1],
			["c.pages", 0],
		]);
		expect(collected[0]?.kind).toBe("pages");
		expect((collected[0]?.payload as { id: string }).id).toBe("a.one");
	});

	it("yields a single entry for non-array field payloads", () => {
		const landing = FIELD_CONTRIBUTION_KINDS.find((k) => k.id === "landing")!;
		const withLanding: readonly Plugin[] = [
			{ id: "a", landing: { page: () => null } },
			{ id: "b" },
		];
		const collected = collectKindContributions(withLanding, landing);
		expect(collected).toHaveLength(1);
		expect(collected[0]?.entryIndex).toBe(0);
		expect(collected[0]?.plugin.id).toBe("a");
	});

	it("collects generic contributions entries by kind", () => {
		const withContribs: readonly Plugin[] = [
			{
				id: "eval.a",
				contributions: [
					{ kind: "eval.stage", id: "s1", version: "1" },
					{ kind: "eval.metric", id: "m1", version: "1" },
					{ kind: "eval.stage", id: "s2", version: "1" },
				],
			},
			{ id: "eval.b", contributions: [{ kind: "eval.stage", id: "s3", version: "1" }] },
		];
		const collected = collectKindContributions(withContribs, evalStageKind);
		expect(collected.map((c) => (c.payload as { id: string }).id)).toEqual(["s1", "s2", "s3"]);
		expect(collected.map((c) => c.entryIndex)).toEqual([0, 2, 0]);
	});

	it("skips plugins without the slot and unknown generic kinds", () => {
		const collected = collectKindContributions(plugins, evalStageKind);
		expect(collected).toEqual([]);
	});
});

describe("collectContributions", () => {
	it("collects the requested kinds and defaults to the field kinds", () => {
		const registry: readonly Plugin[] = [
			{
				id: "a",
				pages: [{ id: "p", path: "/p", component: () => null }],
				contributions: [{ kind: "eval.stage", id: "s", version: "1" }],
			},
		];
		// Default: dedicated field kinds only — generic entries are opt-in.
		expect(collectContributions(registry).map((c) => c.kind)).toEqual(["pages"]);
		expect(collectContributions(registry, [evalStageKind]).map((c) => c.kind)).toEqual([
			"eval.stage",
		]);
	});
});

describe("pluginContributionKinds", () => {
	it("lists dedicated fields present plus generic kind ids", () => {
		const plugin: Plugin = {
			id: "x",
			pages: [{ id: "p", path: "/p", component: () => null }],
			contributions: [
				{ kind: "eval.stage", id: "s", version: "1" },
				{ kind: "eval.stage", id: "s2", version: "1" },
				{ kind: "eval.metric", id: "m", version: "1" },
			],
		};
		expect(pluginContributionKinds(plugin)).toEqual(["pages", "eval.stage", "eval.metric"]);
	});

	it("is empty for a bare marker plugin", () => {
		expect(pluginContributionKinds({ id: "x" })).toEqual([]);
	});
});

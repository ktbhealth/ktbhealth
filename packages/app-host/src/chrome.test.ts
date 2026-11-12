import { describe, expect, it, vi } from "vitest";
import type { ChromeContribution, Plugin } from "@ktb/kernel";

import {
	chromeWhenMatches,
	collectChrome,
	unknownChromeRegions,
	warnUnknownChromeRegions,
} from "./chrome.ts";

const entry = (
	id: string,
	region: string,
	extra?: Partial<ChromeContribution>,
): ChromeContribution => ({
	id,
	region,
	content: { kind: "link", to: `/${id}`, label: id },
	...extra,
});

const plugin = (id: string, chrome: ChromeContribution[]): Plugin => ({ id, chrome }) as Plugin;

describe("chromeWhenMatches", () => {
	it("matches everything without rules", () => {
		expect(chromeWhenMatches(undefined, "/anything")).toBe(true);
		expect(chromeWhenMatches({}, "/anything")).toBe(true);
		expect(chromeWhenMatches({ paths: [] }, "/anything")).toBe(true);
	});

	it("matches exact paths", () => {
		const when = { paths: ["/platform"] };
		expect(chromeWhenMatches(when, "/platform")).toBe(true);
		expect(chromeWhenMatches(when, "/platform/users")).toBe(false);
		expect(chromeWhenMatches(when, "/other")).toBe(false);
	});

	it("matches prefix/* subtrees including the bare prefix", () => {
		const when = { paths: ["/platform/*"] };
		expect(chromeWhenMatches(when, "/platform")).toBe(true);
		expect(chromeWhenMatches(when, "/platform/users")).toBe(true);
		expect(chromeWhenMatches(when, "/platformish")).toBe(false);
		expect(chromeWhenMatches(when, "/")).toBe(false);
	});

	it("lets exceptPaths win over paths", () => {
		const when = { paths: ["/platform/*"], exceptPaths: ["/platform/users"] };
		expect(chromeWhenMatches(when, "/platform/groups")).toBe(true);
		expect(chromeWhenMatches(when, "/platform/users")).toBe(false);
		expect(chromeWhenMatches(when, "/platform/users/42")).toBe(true);
	});
});

describe("collectChrome", () => {
	it("filters by region and when, preserving plugin/entry order", () => {
		const plugins = [
			plugin("a", [entry("a.nav", "app.header.nav"), entry("a.side", "console.sidebar")]),
			plugin("b", [entry("b.nav", "app.header.nav", { when: { paths: ["/x"] } })]),
		];
		expect(collectChrome(plugins, "app.header.nav", "/x").map((e) => e.id)).toEqual([
			"a.nav",
			"b.nav",
		]);
		expect(collectChrome(plugins, "app.header.nav", "/y").map((e) => e.id)).toEqual(["a.nav"]);
		expect(collectChrome(plugins, "console.sidebar", "/x").map((e) => e.id)).toEqual(["a.side"]);
	});

	it("sorts by order, then plugin topo order, then array index", () => {
		const plugins = [
			plugin("a", [
				entry("a.late", "r", { order: 20 }),
				entry("a.first", "r", { order: 0 }),
				entry("a.unordered", "r"),
			]),
			plugin("b", [entry("b.mid", "r", { order: 10 })]),
		];
		expect(collectChrome(plugins, "r", "/").map((e) => e.id)).toEqual([
			"a.first",
			"b.mid",
			"a.late",
			"a.unordered",
		]);
		// Same order → plugin order, then entry index.
		const tied = [
			plugin("a", [entry("a.2", "r", { order: 1 }), entry("a.1", "r", { order: 1 })]),
			plugin("b", [entry("b.1", "r", { order: 1 })]),
		];
		expect(collectChrome(tied, "r", "/").map((e) => e.id)).toEqual(["a.2", "a.1", "b.1"]);
	});

	it("tolerates plugins without a chrome contribution", () => {
		const plugins = [{ id: "bare" } as Plugin, plugin("a", [entry("a.nav", "app.header.nav")])];
		expect(collectChrome(plugins, "app.header.nav", "/").map((e) => e.id)).toEqual(["a.nav"]);
	});
});

describe("unknownChromeRegions", () => {
	it("lists contributed regions outside the known set", () => {
		const plugins = [
			plugin("a", [entry("a.1", "app.header.nav"), entry("a.2", "bogus.region")]),
			plugin("b", [entry("b.1", "bogus.region"), entry("b.2", "also.bogus")]),
		];
		expect(unknownChromeRegions(plugins, new Set(["app.header.nav"]))).toEqual([
			"also.bogus",
			"bogus.region",
		]);
	});

	it("ignores plugins without chrome", () => {
		const plugins = [{ id: "bare" } as Plugin];
		expect(unknownChromeRegions(plugins, new Set())).toEqual([]);
	});

	it("warns once per unknown region", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const plugins = [plugin("a", [entry("a.1", "bogus"), entry("a.2", "bogus")])];
		warnUnknownChromeRegions(plugins, new Set());
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("bogus"));
		warn.mockRestore();
	});
});

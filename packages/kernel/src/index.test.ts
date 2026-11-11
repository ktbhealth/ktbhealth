import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { definePlugin } from "./index.ts";

const t = sqliteTable("t", { id: text("id").primaryKey() });

describe("definePlugin", () => {
	it("returns the plugin spec unchanged", () => {
		const p = definePlugin({ id: "x" });
		expect(p.id).toBe("x");
	});

	it("carries a single contribution kind per plugin", () => {
		const chrome = definePlugin({
			id: "x",
			chrome: [
				{
					id: "x.nav",
					region: "app.header.nav",
					content: { kind: "link", to: "/y", label: "Y" },
				},
			],
		});
		const panel = definePlugin({
			id: "x",
			panel: { pages: [{ id: "x.page", path: "/platform/x", component: () => null }] },
		});
		const tables = definePlugin({ id: "x", tables: { t } });
		expect("chrome" in chrome && chrome.chrome[0]?.content.kind).toBe("link");
		expect("panel" in panel && panel.panel.pages?.[0]?.path).toBe("/platform/x");
		expect("tables" in tables && tables.tables.t).toBe(t);
	});

	it("carries pages contributions with an optional shell context (P-059)", () => {
		const Page = () => null;
		const pages = definePlugin({
			id: "x",
			pages: [
				{ id: "x.about", path: "/about", component: Page },
				{
					id: "x.console",
					path: "/platform/custom",
					component: Page,
					context: "console",
				},
			],
		});
		expect("pages" in pages && pages.pages[0]?.path).toBe("/about");
		expect("pages" in pages && pages.pages[1]?.context).toBe("console");
	});

	it("carries landing page and chrome footer contributions", () => {
		const Page = () => null;
		const landing = definePlugin({ id: "x", landing: { page: Page } });
		const chrome = definePlugin({
			id: "x",
			chrome: [
				{
					id: "x.footer",
					region: "app.footer.blocks",
					content: {
						kind: "footerBlock",
						block: { heading: "H", links: [{ to: "/a", label: "A" }] },
					},
				},
			],
		});
		expect("landing" in landing && landing.landing.page).toBe(Page);
		expect(
			"chrome" in chrome &&
				chrome.chrome[0]?.content.kind === "footerBlock" &&
				chrome.chrome[0].content.block.links[0]?.to,
		).toBe("/a");
	});

	it("rejects multi-concern plugin objects at compile time", () => {
		// @ts-expect-error — a plugin may declare exactly one contribution kind
		definePlugin({ id: "x", tables: { t }, chrome: [] });
	});
});

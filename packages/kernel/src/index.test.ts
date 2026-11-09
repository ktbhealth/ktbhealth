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
		const landingNav = definePlugin({
			id: "x",
			landingNav: [{ to: "/y", label: "Y" }],
		});
		const panel = definePlugin({
			id: "x",
			panel: { sidebar: [{ to: "/platform/x", label: "X" }] },
		});
		const tables = definePlugin({ id: "x", tables: { t } });
		expect("landingNav" in landingNav && landingNav.landingNav[0]?.to).toBe("/y");
		expect("panel" in panel && panel.panel.sidebar?.[0]?.to).toBe("/platform/x");
		expect("tables" in tables && tables.tables.t).toBe(t);
	});

	it("carries landing page and footer contributions", () => {
		const Page = () => null;
		const landing = definePlugin({ id: "x", landing: { page: Page } });
		const footer = definePlugin({
			id: "x",
			landingFooter: { blocks: [{ heading: "H", links: [{ to: "/a", label: "A" }] }] },
		});
		expect("landing" in landing && landing.landing.page).toBe(Page);
		expect("landingFooter" in footer && footer.landingFooter.blocks[0]?.links[0]?.to).toBe("/a");
	});

	it("rejects multi-concern plugin objects at compile time", () => {
		// @ts-expect-error — a plugin may declare exactly one contribution kind
		definePlugin({ id: "x", tables: { t }, landingNav: [{ to: "/y", label: "Y" }] });
	});
});

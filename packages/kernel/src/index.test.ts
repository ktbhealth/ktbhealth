import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { definePlugin } from "./index.ts";

const t = sqliteTable("t", { id: text("id").primaryKey() });

describe("definePlugin", () => {
	it("returns the plugin spec unchanged", () => {
		const p = definePlugin({ id: "x" });
		expect(p.id).toBe("x");
	});

	it("carries nav, panel and tables", () => {
		const p = definePlugin({
			id: "x",
			nav: [{ to: "/y", label: "Y" }],
			panel: { sidebar: [{ to: "/platform/x", label: "X" }] },
			tables: { t },
		});
		expect(p.nav?.[0]?.to).toBe("/y");
		expect(p.panel?.sidebar?.[0]?.to).toBe("/platform/x");
		expect(p.tables?.t).toBe(t);
	});
});

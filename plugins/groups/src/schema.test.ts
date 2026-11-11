import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { describe, expect, it } from "vitest";

import { groupMembers, groups } from "@ktb/db/schema";

describe("groups schema", () => {
	it("exposes table config with slug unique", () => {
		const cfg = getTableConfig(groups);
		expect(cfg.name).toBe("groups");
		expect(cfg.columns.map((c) => c.name)).toEqual([
			"id",
			"name",
			"slug",
			"kind",
			"meta",
			"created_at",
			"updated_at",
		]);
	});

	it("exposes group_members with cascade FK and unique member index", () => {
		const cfg = getTableConfig(groupMembers);
		expect(cfg.name).toBe("group_members");
		expect(cfg.columns.map((c) => c.name)).toContain("group_id");
		for (const fk of cfg.foreignKeys) {
			expect(fk.reference().foreignColumns.length).toBeGreaterThan(0);
			expect(fk.onDelete).toBe("cascade");
		}
		expect(cfg.indexes.length + cfg.uniqueConstraints.length).toBeGreaterThan(0);
	});
});

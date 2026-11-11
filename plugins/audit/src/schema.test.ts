import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { describe, expect, it } from "vitest";

import { groups } from "@ktb/groups/schema";

import { adminAudit } from "./schema.ts";

describe("admin_audit schema", () => {
	it("exposes the audit columns", () => {
		const cfg = getTableConfig(adminAudit);
		expect(cfg.name).toBe("admin_audit");
		expect(cfg.columns.map((c) => c.name)).toEqual([
			"id",
			"actor_user_id",
			"actor_email",
			"action",
			"target_type",
			"target_id",
			"detail",
			"tenant_id",
			"created_at",
		]);
	});

	it("indexes created_at, action and actor_user_id and FKs tenant_id to groups", () => {
		const cfg = getTableConfig(adminAudit);
		expect(cfg.indexes).toHaveLength(3);
		for (const fk of cfg.foreignKeys) {
			expect(fk.onDelete).toBe("set null");
			// reference() evaluates the lazy `() => groups.id` callback.
			const ref = fk.reference();
			expect(ref.foreignTable).toBe(groups);
			expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
		}
	});
});

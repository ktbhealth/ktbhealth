import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { describe, expect, it } from "vitest";

import { makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { eq } from "drizzle-orm";

import { doctors } from "./schema.ts";

const DDL = `
CREATE TABLE doctors (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, crm TEXT, specialty TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
`;

describe("doctors schema", () => {
	it("exposes table config with a unique cascading user FK", () => {
		const cfg = getTableConfig(doctors);
		expect(cfg.name).toBe("doctors");
		expect(cfg.columns.map((c) => c.name)).toEqual([
			"id",
			"user_id",
			"display_name",
			"crm",
			"specialty",
			"created_at",
			"updated_at",
		]);
		expect(cfg.columns.find((c) => c.name === "user_id")?.isUnique).toBe(true);
		for (const fk of cfg.foreignKeys) {
			expect(fk.reference().foreignColumns.map((c) => c.name)).toEqual(["id"]);
			expect(fk.onDelete).toBe("cascade");
		}
	});

	it("fires $onUpdate on doctors", async () => {
		const db = makeDb(makeD1(DDL));
		const [created] = await db
			.insert(doctors)
			.values({ userId: "u1", displayName: "Dra. Ana", updatedAt: new Date(0) })
			.returning();
		await db.update(doctors).set({ crm: "CRM-SP 1" }).where(eq(doctors.id, created!.id));
		const [row] = await db.select().from(doctors);
		expect(row!.crm).toBe("CRM-SP 1");
		expect(row!.updatedAt.getTime()).toBeGreaterThan(0);
	});
});

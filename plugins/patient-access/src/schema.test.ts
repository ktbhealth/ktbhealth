import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { describe, expect, it } from "vitest";

import { makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { eq } from "drizzle-orm";

import {
	PATIENT_ACCESS_RELATIONS,
	PATIENT_ACCESS_SOURCES,
	PATIENT_ACCESS_STATUSES,
	patientAccess,
} from "./schema.ts";

const DDL = `
CREATE TABLE patient_access (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL, user_id TEXT, email TEXT, relation TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, granted_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX patient_access_patient_user_idx ON patient_access (patient_id, user_id);
`;

describe("patient-access schema", () => {
	it("exposes patient_access with cascading FKs and lookup indexes", () => {
		const cfg = getTableConfig(patientAccess);
		expect(cfg.name).toBe("patient_access");
		expect(cfg.columns.map((c) => c.name)).toEqual([
			"id",
			"patient_id",
			"user_id",
			"email",
			"relation",
			"status",
			"source",
			"granted_by",
			"created_at",
			"updated_at",
		]);
		expect(cfg.foreignKeys).toHaveLength(2);
		for (const fk of cfg.foreignKeys) {
			expect(fk.reference().foreignColumns.map((c) => c.name)).toEqual(["id"]);
			expect(fk.onDelete).toBe("cascade");
		}
		expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual([
			"patient_access_email_idx",
			"patient_access_patient_user_idx",
			"patient_access_user_idx",
		]);
	});

	it("declares the relation, status and source vocabularies", () => {
		expect(PATIENT_ACCESS_RELATIONS).toEqual(["self", "guardian"]);
		expect(PATIENT_ACCESS_STATUSES).toEqual(["invited", "pending", "active", "revoked"]);
		expect(PATIENT_ACCESS_SOURCES).toEqual(["invite", "cpf"]);
	});

	it("allows several unclaimed invites per patient but one row per user", async () => {
		const db = makeDb(makeD1(DDL));
		const invite = { patientId: 1, relation: "guardian", status: "invited", source: "invite" };
		await db.insert(patientAccess).values({ ...invite, email: "mom@ktb.test" });
		const [second] = await db
			.insert(patientAccess)
			.values({ ...invite, email: "dad@ktb.test", updatedAt: new Date(0) })
			.returning();
		await db
			.update(patientAccess)
			.set({ userId: "u1", status: "active" })
			.where(eq(patientAccess.id, second!.id));
		const [claimed] = await db.select().from(patientAccess).where(eq(patientAccess.userId, "u1"));
		expect(claimed!.updatedAt.getTime()).toBeGreaterThan(0);
		await expect(
			db
				.insert(patientAccess)
				.values({ patientId: 1, userId: "u1", relation: "self", status: "pending", source: "cpf" }),
		).rejects.toThrow(/Failed query/);
	});
});

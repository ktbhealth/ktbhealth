import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { describe, expect, it } from "vitest";

import { makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";

import { permissionEpoch, rolePermissions, roles, subjectRoles } from "./schema.ts";

const DDL = `
CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE role_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, resource TEXT NOT NULL, action TEXT NOT NULL, effect TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE subject_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, tenant_id TEXT, granted_by TEXT, expires_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE permission_epoch (id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0);
`;

describe("rbac schema", () => {
	it("exposes table config and resolves the roles FK on grant tables", () => {
		for (const t of [roles, rolePermissions, subjectRoles, permissionEpoch]) {
			const cfg = getTableConfig(t);
			expect(cfg.name).toBeTruthy();
			expect(cfg.columns.length).toBeGreaterThan(0);
			for (const fk of cfg.foreignKeys) {
				expect(fk.reference().foreignColumns.length).toBeGreaterThan(0);
				expect(fk.onDelete).toBe("cascade");
			}
		}
	});

	it("fires roles.$onUpdate on drizzle update", async () => {
		const db = makeDb(makeD1(DDL));
		await db.insert(roles).values({
			id: 1,
			name: "auditor",
			description: null,
			meta: null,
		});
		await db.update(roles).set({ description: "RO" }).where(eq(roles.id, 1));
		const row = await db.select().from(roles).where(eq(roles.id, 1));
		expect(row[0]?.description).toBe("RO");
		expect(row[0]?.updatedAt.getTime()).toBeGreaterThan(0);
	});
});

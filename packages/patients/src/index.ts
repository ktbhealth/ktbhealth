import { definePlugin } from "@ktb/kernel";
import { eq } from "drizzle-orm";

import type { DbClient } from "@ktb/db";
import { patients } from "./schema.ts";

export async function listPatients(db: DbClient, ownerId: string) {
	return db.select().from(patients).where(eq(patients.ownerId, ownerId));
}

export async function createPatient(db: DbClient, ownerId: string, name: string) {
	const rows = await db
		.insert(patients)
		.values({ ownerId, name, createdAt: new Date() })
		.returning();
	return rows[0] ?? null;
}

export const plugin = definePlugin({
	id: "patients",
	tables: { patients },
});

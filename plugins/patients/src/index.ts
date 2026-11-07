import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { eq } from "drizzle-orm";

import { Db, type DbClient } from "@ktb/db";
import { definePlugin } from "@ktb/kernel";
import { patients } from "./schema.ts";

export type Patient = typeof patients.$inferSelect;

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

/** Patients domain port — Effect service, swappable in tests. */
export class Patients extends Context.Service<
	Patients,
	{
		readonly list: (ownerId: string) => Effect.Effect<Patient[]>;
		readonly create: (ownerId: string, name: string) => Effect.Effect<Patient | null>;
	}
>()("@ktb/patients/Patients") {}

export const PatientsLive = Layer.effect(
	Patients,
	Effect.gen(function* () {
		const db = yield* Db;
		return Patients.of({
			list: (ownerId) => Effect.promise(() => listPatients(db, ownerId)),
			create: (ownerId, name) => Effect.promise(() => createPatient(db, ownerId, name)),
		});
	}),
);

export const plugin = definePlugin({
	id: "patients",
	tables: { patients },
	services: PatientsLive,
});

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { eq } from "drizzle-orm";

import { Db, type DbClient } from "@ktb/db";
import { definePlugin } from "@ktb/kernel";
import { requireCanAs, requirePrincipalUser, type Forbidden } from "@ktb/authz";
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

/**
 * Patients domain port — Effect service, swappable in tests.
 *
 * Every method enforces authorization against the request `Principal`
 * (@ktb/authz): `ownerId` must be the bound principal's userId and the
 * permix rule for the action must pass. With no principal (system
 * context) all methods fail `Forbidden` — there is no unauthenticated
 * patient access.
 */
export class Patients extends Context.Service<
	Patients,
	{
		readonly list: (ownerId: string) => Effect.Effect<Patient[], Forbidden>;
		readonly create: (ownerId: string, name: string) => Effect.Effect<Patient | null, Forbidden>;
	}
>()("@ktb/patients/Patients") {}

export const PatientsLive = Layer.effect(
	Patients,
	Effect.gen(function* () {
		const db = yield* Db;
		return Patients.of({
			list: Effect.fn("Patients.list")(function* (ownerId: string) {
				yield* requireCanAs("patient.read", { ownerId });
				return yield* Effect.promise(() => listPatients(db, ownerId));
			}),
			create: Effect.fn("Patients.create")(function* (ownerId: string, name: string) {
				yield* requirePrincipalUser(ownerId, "patient.create");
				yield* requireCanAs("patient.create");
				yield* Effect.annotateCurrentSpan({ ownerId });
				yield* Effect.logInfo("patient create", { ownerId });
				return yield* Effect.promise(() => createPatient(db, ownerId, name));
			}),
		});
	}),
);

export const plugin = definePlugin({
	id: "patients",
	tables: { patients },
	services: PatientsLive,
});

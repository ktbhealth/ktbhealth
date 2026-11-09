import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { asc, eq } from "drizzle-orm";
import { index, route } from "@tanstack/virtual-file-routes";

import { Db, type DbClient } from "@ktb/db";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { requireCanAs, requirePrincipalUser, type Forbidden } from "@ktb/authz";
import type { PatientFields } from "./record.ts";
import { patients } from "./schema.ts";

export type Patient = typeof patients.$inferSelect;

export async function listPatients(db: DbClient, ownerId: string) {
	return db
		.select()
		.from(patients)
		.where(eq(patients.ownerId, ownerId))
		.orderBy(asc(patients.name));
}

/** Fetches by id regardless of caller — authz happens in the service. */
export async function getPatient(db: DbClient, id: number) {
	const rows = await db.select().from(patients).where(eq(patients.id, id)).limit(1);
	return rows[0] ?? null;
}

export async function createPatient(db: DbClient, ownerId: string, fields: PatientFields) {
	const rows = await db
		.insert(patients)
		.values({ ...fields, ownerId, createdAt: new Date() })
		.returning();
	return rows[0] ?? null;
}

export async function updatePatient(db: DbClient, id: number, fields: PatientFields) {
	const rows = await db
		.update(patients)
		.set({ ...fields, updatedAt: new Date() })
		.where(eq(patients.id, id))
		.returning();
	return rows[0] ?? null;
}

/**
 * Patients domain port — Effect service, swappable in tests.
 *
 * Every method enforces authorization against the request `Principal`
 * (@ktb/authz): `ownerId` must be the bound principal's userId and the
 * permix rule for the action must pass against the row's real owner. With
 * no principal (system context) all methods fail `Forbidden` — there is
 * no unauthenticated patient access. `fields` arrive already validated
 * (`validatePatient` in ./record.ts).
 */
export class Patients extends Context.Service<
	Patients,
	{
		readonly list: (ownerId: string) => Effect.Effect<Patient[], Forbidden>;
		readonly get: (ownerId: string, id: number) => Effect.Effect<Patient | null, Forbidden>;
		readonly create: (
			ownerId: string,
			fields: PatientFields,
		) => Effect.Effect<Patient | null, Forbidden>;
		readonly update: (
			ownerId: string,
			id: number,
			fields: PatientFields,
		) => Effect.Effect<Patient | null, Forbidden>;
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
			get: Effect.fn("Patients.get")(function* (ownerId: string, id: number) {
				yield* requirePrincipalUser(ownerId, "patient.read");
				const row = yield* Effect.promise(() => getPatient(db, id));
				if (row === null) return null;
				// Someone else's row is Forbidden, not silently null.
				yield* requireCanAs("patient.read", { ownerId: row.ownerId });
				return row;
			}),
			create: Effect.fn("Patients.create")(function* (ownerId: string, fields: PatientFields) {
				yield* requirePrincipalUser(ownerId, "patient.create");
				yield* requireCanAs("patient.create");
				yield* Effect.annotateCurrentSpan({ ownerId });
				yield* Effect.logInfo("patient create", { ownerId });
				return yield* Effect.promise(() => createPatient(db, ownerId, fields));
			}),
			update: Effect.fn("Patients.update")(function* (
				ownerId: string,
				id: number,
				fields: PatientFields,
			) {
				yield* requirePrincipalUser(ownerId, "patient.update");
				const row = yield* Effect.promise(() => getPatient(db, id));
				if (row === null) return null;
				yield* requireCanAs("patient.update", { ownerId: row.ownerId });
				yield* Effect.annotateCurrentSpan({ ownerId, patientId: id });
				yield* Effect.logInfo("patient update", { ownerId, patientId: id });
				return yield* Effect.promise(() => updatePatient(db, id, fields));
			}),
		});
	}),
);

export const patientsTablesPlugin = definePlugin({
	id: "patients.tables",
	tables: { patients },
});

export const patientsServicesPlugin = definePlugin({
	id: "patients.services",
	services: PatientsLive,
});

// Route subtree composed into the host's virtualRouteConfig. File paths
// resolve relative to the host's routes directory (apps/web/src/routes);
// the route modules there wire these paths to this plugin's views and to
// host server functions, which plugins cannot import.
export const patientsRoutesPlugin = definePlugin({
	id: "patients.routes",
	routes: [
		route("patients", [
			index("patients/index.tsx"),
			route("new", "patients/new.tsx"),
			route("$id", [index("patients/$id.tsx"), route("edit", "patients/$id.edit.tsx")]),
		]),
	],
});

export const patientsNavPlugin = definePlugin({
	id: "patients.nav",
	nav: [{ to: "/patients", label: "Patients" }],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	patientsTablesPlugin,
	patientsServicesPlugin,
	patientsRoutesPlugin,
	patientsNavPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"patients.tables": true;
		"patients.services": true;
		"patients.routes": true;
		"patients.nav": true;
	}
}

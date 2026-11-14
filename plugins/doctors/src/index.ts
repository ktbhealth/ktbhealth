import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { eq } from "drizzle-orm";

import { DoctorDelegations, DoctorProfiles, type DoctorProfile } from "@ktb/auth";
import { Forbidden, Principal } from "@ktb/authz";
import { Db, type DbClient } from "@ktb/db";
import { user } from "@ktb/db/schema";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { physical } from "@tanstack/virtual-file-routes";

import { doctors, type Doctor } from "./schema.ts";

export type { Doctor } from "./schema.ts";

export async function getDoctorByUser(db: DbClient, userId: string): Promise<Doctor | null> {
	const rows = await db.select().from(doctors).where(eq(doctors.userId, userId));
	return rows[0] ?? null;
}

/**
 * The user's doctor profile, created on first call. Idempotent: an
 * existing profile is returned untouched — `displayName` only seeds a
 * new one.
 */
export async function ensureDoctorProfile(
	db: DbClient,
	userId: string,
	displayName: string,
): Promise<Doctor> {
	await db.insert(doctors).values({ userId, displayName }).onConflictDoNothing();
	return (await getDoctorByUser(db, userId))!;
}

/** The user's own doctor profile as a directory entry ("owner") — empty
 * for an account that is not a doctor. */
export async function listOwnDoctorProfiles(
	db: DbClient,
	userId: string,
): Promise<DoctorProfile[]> {
	const rows = await db
		.select({
			doctorId: doctors.id,
			userId: doctors.userId,
			email: user.email,
			displayName: doctors.displayName,
		})
		.from(doctors)
		.innerJoin(user, eq(doctors.userId, user.id))
		.where(eq(doctors.userId, userId));
	return rows.map((row) => ({ ...row, role: "owner" as const }));
}

/**
 * `DoctorProfiles` directory: the user's own profile first, then the
 * profiles a deployed `DoctorDelegations` source hands them. The source
 * is looked up per call, not when the layer is built, so the directory
 * never depends on the plugin that provides it.
 */
export const DoctorProfilesLive = Layer.effect(
	DoctorProfiles,
	Effect.gen(function* () {
		const db = yield* Db;
		return DoctorProfiles.of({
			listFor: Effect.fn("DoctorProfiles.listFor")(function* (userId: string) {
				const own = yield* Effect.promise(() => listOwnDoctorProfiles(db, userId));
				const source = yield* Effect.serviceOption(DoctorDelegations);
				if (Option.isNone(source)) return own;
				return [...own, ...(yield* source.value.listFor(userId))];
			}),
			claimInvites: Effect.fn("DoctorProfiles.claimInvites")(function* (userId: string) {
				const source = yield* Effect.serviceOption(DoctorDelegations);
				return Option.isNone(source) ? 0 : yield* source.value.claimInvites(userId);
			}),
		});
	}),
);

/**
 * Doctors domain port. A profile is what makes an account a doctor;
 * `ensureProfile` creates the caller's *own* profile only — it fails
 * `Forbidden` without a principal and under delegation (a secretary
 * acting for a doctor cannot mint profiles).
 */
export class Doctors extends Context.Service<
	Doctors,
	{
		readonly ensureProfile: (displayName: string) => Effect.Effect<Doctor, Forbidden>;
	}
>()("@ktb/doctors/Doctors") {}

export const DoctorsLive = Layer.effect(
	Doctors,
	Effect.gen(function* () {
		const db = yield* Db;
		return Doctors.of({
			ensureProfile: Effect.fn("Doctors.ensureProfile")(function* (displayName: string) {
				const principal = yield* Principal;
				if (principal === null || principal.actorId !== undefined) {
					return yield* Effect.fail(new Forbidden({ path: "doctor.create" }));
				}
				return yield* Effect.promise(() => ensureDoctorProfile(db, principal.userId, displayName));
			}),
		});
	}),
);

export const doctorsTablesPlugin = definePlugin({
	id: "doctors.tables",
	tables: { doctors },
});

export const doctorsServicesPlugin = definePlugin({
	id: "doctors.services",
	services: Layer.mergeAll(DoctorsLive, DoctorProfilesLive),
});

// Route subtree composed into the host's virtualRouteConfig: the route
// modules live in THIS package (src/routes/**), discovered by a
// physical() directory scan relative to the host's routes directory.
export const doctorsRoutesPlugin = definePlugin({
	id: "doctors.routes",
	routes: [physical("/doctors", "../../../../plugins/doctors/src/routes")],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	doctorsTablesPlugin,
	doctorsServicesPlugin,
	doctorsRoutesPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"doctors.tables": true;
		"doctors.services": true;
		"doctors.routes": true;
	}
}

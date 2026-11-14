import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { and, asc, eq, ne } from "drizzle-orm";

import { DoctorDelegations, type DoctorProfile } from "@ktb/auth";
import { Forbidden, Principal } from "@ktb/authz";
import { Db, type DbClient } from "@ktb/db";
import { doctors, user } from "@ktb/db/schema";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { physical } from "@tanstack/virtual-file-routes";

import { doctorAccess, type DoctorAccess } from "./schema.ts";

export type { DoctorAccess, DoctorAccessRole, DoctorAccessStatus } from "./schema.ts";

/**
 * The doctor profiles delegated to `userId`: one per *active*
 * `doctor_access` row, by doctor name. Invited and revoked rows grant
 * nothing; the user's own profile is the doctors plugin's to list.
 */
export async function listDelegatedProfiles(
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
		.from(doctorAccess)
		.innerJoin(doctors, eq(doctorAccess.doctorId, doctors.id))
		.innerJoin(user, eq(doctors.userId, user.id))
		.where(and(eq(doctorAccess.userId, userId), eq(doctorAccess.status, "active")))
		.orderBy(doctors.displayName, doctors.id);
	return rows.map((row) => ({ ...row, role: "secretary" as const }));
}

/** Emails are matched case-insensitively: stored and compared lowercased. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Activate every pending invite addressed to the user's email — only
 * when that email is verified, so nobody claims a delegation by signing
 * up with someone else's address. Returns how many were claimed.
 */
export async function claimDoctorInvites(db: DbClient, userId: string): Promise<number> {
	const [account] = await db
		.select({ email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, userId));
	if (!account?.emailVerified) return 0;
	const claimed = await db
		.update(doctorAccess)
		.set({ userId, status: "active" })
		.where(
			and(
				eq(doctorAccess.email, normalizeEmail(account.email)),
				eq(doctorAccess.status, "invited"),
			),
		)
		.returning({ id: doctorAccess.id });
	return claimed.length;
}

/** `DoctorDelegations` source backed by `doctor_access` — what the
 * doctors plugin's profile directory adds to a user's own profile. */
export const DoctorDelegationsLive = Layer.effect(
	DoctorDelegations,
	Effect.gen(function* () {
		const db = yield* Db;
		return DoctorDelegations.of({
			listFor: Effect.fn("DoctorDelegations.listFor")(function* (userId: string) {
				return yield* Effect.promise(() => listDelegatedProfiles(db, userId));
			}),
			claimInvites: Effect.fn("DoctorDelegations.claimInvites")(function* (userId: string) {
				return yield* Effect.promise(() => claimDoctorInvites(db, userId));
			}),
		});
	}),
);

/** A doctor's delegations, newest invites last; revoked rows are history
 * and left out. */
export async function listDoctorAccess(db: DbClient, doctorId: number): Promise<DoctorAccess[]> {
	return db
		.select()
		.from(doctorAccess)
		.where(and(eq(doctorAccess.doctorId, doctorId), ne(doctorAccess.status, "revoked")))
		.orderBy(asc(doctorAccess.email));
}

/**
 * Invite `email` to act for the doctor. When an account with that
 * *verified* email already exists the delegation is active at once;
 * otherwise it waits as "invited" until such an account signs in.
 * Re-inviting a revoked or pending address reuses its row.
 */
export async function inviteSecretary(
	db: DbClient,
	input: { readonly doctorId: number; readonly email: string; readonly invitedBy: string },
): Promise<DoctorAccess> {
	const [account] = await db
		.select({ id: user.id, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.email, input.email));
	const link = account?.emailVerified
		? { userId: account.id, status: "active" }
		: { userId: null, status: "invited" };
	const [row] = await db
		.insert(doctorAccess)
		.values({ doctorId: input.doctorId, email: input.email, invitedBy: input.invitedBy, ...link })
		.onConflictDoUpdate({
			target: [doctorAccess.doctorId, doctorAccess.email],
			set: { invitedBy: input.invitedBy, ...link },
		})
		.returning();
	return row!;
}

/** Revoke a delegation of this doctor; false when the row is not theirs. */
export async function revokeSecretary(
	db: DbClient,
	doctorId: number,
	id: number,
): Promise<boolean> {
	const revoked = await db
		.update(doctorAccess)
		.set({ status: "revoked" })
		.where(and(eq(doctorAccess.id, id), eq(doctorAccess.doctorId, doctorId)))
		.returning({ id: doctorAccess.id });
	return revoked.length > 0;
}

/** Why an invite was refused — codes on the wire, copy in the view. */
export type InviteErrorCode = "invalid_email" | "self";

export class InviteRejected extends Data.TaggedError("InviteRejected")<{
	readonly code: InviteErrorCode;
}> {}

/**
 * Secretaries domain port: who may act for a doctor. Every operation
 * manages the *caller's own* doctor profile — it fails `Forbidden`
 * without a principal, under delegation (a secretary cannot manage a
 * doctor's secretaries) and for accounts with no doctor profile.
 */
export class Secretaries extends Context.Service<
	Secretaries,
	{
		readonly list: () => Effect.Effect<DoctorAccess[], Forbidden>;
		readonly invite: (email: string) => Effect.Effect<DoctorAccess, Forbidden | InviteRejected>;
		readonly revoke: (id: number) => Effect.Effect<boolean, Forbidden>;
	}
>()("@ktb/secretaries/Secretaries") {}

export const SecretariesLive = Layer.effect(
	Secretaries,
	Effect.gen(function* () {
		const db = yield* Db;
		/** The caller's own doctor profile and account email. */
		const ownDoctor = (path: string) =>
			Effect.gen(function* () {
				const principal = yield* Principal;
				if (principal === null || principal.actorId !== undefined) {
					return yield* Effect.fail(new Forbidden({ path }));
				}
				const [own] = yield* Effect.promise(() =>
					db
						.select({ doctorId: doctors.id, userId: doctors.userId, email: user.email })
						.from(doctors)
						.innerJoin(user, eq(doctors.userId, user.id))
						.where(eq(doctors.userId, principal.userId)),
				);
				if (own === undefined) return yield* Effect.fail(new Forbidden({ path }));
				return own;
			});
		return Secretaries.of({
			list: Effect.fn("Secretaries.list")(function* () {
				const own = yield* ownDoctor("secretary.read");
				return yield* Effect.promise(() => listDoctorAccess(db, own.doctorId));
			}),
			invite: Effect.fn("Secretaries.invite")(function* (rawEmail: string) {
				const own = yield* ownDoctor("secretary.invite");
				const email = normalizeEmail(rawEmail);
				if (!EMAIL_SHAPE.test(email)) {
					return yield* Effect.fail(new InviteRejected({ code: "invalid_email" }));
				}
				if (email === normalizeEmail(own.email)) {
					return yield* Effect.fail(new InviteRejected({ code: "self" }));
				}
				return yield* Effect.promise(() =>
					inviteSecretary(db, { doctorId: own.doctorId, email, invitedBy: own.userId }),
				);
			}),
			revoke: Effect.fn("Secretaries.revoke")(function* (id: number) {
				const own = yield* ownDoctor("secretary.revoke");
				return yield* Effect.promise(() => revokeSecretary(db, own.doctorId, id));
			}),
		});
	}),
);

export const secretariesTablesPlugin = definePlugin({
	id: "secretaries.tables",
	tables: { doctorAccess },
});

export const secretariesServicesPlugin = definePlugin({
	id: "secretaries.services",
	services: Layer.mergeAll(DoctorDelegationsLive, SecretariesLive),
});

// Route subtree composed into the host's virtualRouteConfig: the route
// modules live in THIS package (src/routes/**), discovered by a
// physical() directory scan relative to the host's routes directory.
export const secretariesRoutesPlugin = definePlugin({
	id: "secretaries.routes",
	routes: [physical("/secretaries", "../../../../plugins/secretaries/src/routes")],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	secretariesTablesPlugin,
	secretariesServicesPlugin,
	secretariesRoutesPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"secretaries.tables": true;
		"secretaries.services": true;
		"secretaries.routes": true;
	}
}

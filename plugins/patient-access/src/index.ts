import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
import { physical } from "@tanstack/virtual-file-routes";

import { PatientProfiles, type PatientProfile } from "@ktb/auth";
import { Forbidden, Principal } from "@ktb/authz";
import { Db, type DbClient } from "@ktb/db";
import { patients, user } from "@ktb/db/schema";
import { definePlugin, type Plugin } from "@ktb/kernel";

import {
	PATIENT_ACCESS_RELATIONS,
	patientAccess,
	type PatientAccess,
	type PatientAccessRelation,
} from "./schema.ts";

export type {
	PatientAccess,
	PatientAccessRelation,
	PatientAccessSource,
	PatientAccessStatus,
} from "./schema.ts";

/** Emails are matched case-insensitively: stored and compared lowercased. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Every patient record `userId` may open in the portal: the ones they
 * hold an *active* `patient_access` row for. Invited, pending and
 * revoked rows grant nothing.
 */
export async function listPatientProfiles(db: DbClient, userId: string): Promise<PatientProfile[]> {
	const rows = await db
		.select({
			patientId: patients.id,
			name: patients.name,
			relation: patientAccess.relation,
		})
		.from(patientAccess)
		.innerJoin(patients, eq(patientAccess.patientId, patients.id))
		.where(and(eq(patientAccess.userId, userId), eq(patientAccess.status, "active")))
		.orderBy(patients.name, patients.id);
	return rows.map((row) => ({ ...row, relation: row.relation as PatientAccessRelation }));
}

const accountOf = async (db: DbClient, userId: string) => {
	const [account] = await db
		.select({ email: user.email, emailVerified: user.emailVerified, cpf: user.cpf })
		.from(user)
		.where(eq(user.id, userId));
	return account;
};

/**
 * Activate every pending invite addressed to the user's email — only
 * when that email is verified, so nobody claims a patient record by
 * signing up with someone else's address. An invite for a record the
 * user already has a link to (e.g. a pending CPF match) upgrades that
 * link instead of duplicating it. Returns how many were claimed.
 */
export async function claimPatientInvites(db: DbClient, userId: string): Promise<number> {
	const account = await accountOf(db, userId);
	if (!account?.emailVerified) return 0;
	const invites = await db
		.select()
		.from(patientAccess)
		.where(
			and(
				eq(patientAccess.email, normalizeEmail(account.email)),
				eq(patientAccess.status, "invited"),
			),
		);
	for (const invite of invites) {
		const [existing] = await db
			.select({ id: patientAccess.id })
			.from(patientAccess)
			.where(and(eq(patientAccess.patientId, invite.patientId), eq(patientAccess.userId, userId)));
		if (existing === undefined) {
			await db
				.update(patientAccess)
				.set({ userId, status: "active" })
				.where(eq(patientAccess.id, invite.id));
			continue;
		}
		await db
			.update(patientAccess)
			.set({
				status: "active",
				relation: invite.relation,
				source: "invite",
				grantedBy: invite.grantedBy,
			})
			.where(eq(patientAccess.id, existing.id));
		await db.delete(patientAccess).where(eq(patientAccess.id, invite.id));
	}
	return invites.length;
}

/**
 * Link the user to every patient record carrying their CPF that they
 * have no link to yet. A CPF is not a secret, so the match alone never
 * opens a record: the link is "active" only when the record's email
 * equals the user's *verified* email; otherwise it is "pending" until
 * the doctor approves it. Existing links — revoked ones included — are
 * left untouched. Returns how many links were created.
 */
export async function matchPatientsByCpf(db: DbClient, userId: string): Promise<number> {
	const account = await accountOf(db, userId);
	if (!account?.cpf) return 0;
	const candidates = await db
		.select({ id: patients.id, email: patients.email })
		.from(patients)
		.where(eq(patients.cpf, account.cpf));
	if (candidates.length === 0) return 0;
	const linked = await db
		.select({ patientId: patientAccess.patientId })
		.from(patientAccess)
		.where(
			and(
				eq(patientAccess.userId, userId),
				inArray(
					patientAccess.patientId,
					candidates.map((c) => c.id),
				),
			),
		);
	const linkedIds = new Set(linked.map((l) => l.patientId));
	const fresh = candidates.filter((c) => !linkedIds.has(c.id));
	const email = normalizeEmail(account.email);
	for (const candidate of fresh) {
		const proven =
			account.emailVerified &&
			candidate.email !== null &&
			normalizeEmail(candidate.email) === email;
		await db.insert(patientAccess).values({
			patientId: candidate.id,
			userId,
			relation: "self",
			status: proven ? "active" : "pending",
			source: "cpf",
		});
	}
	return fresh.length;
}

/** `PatientProfiles` directory backed by `patient_access` + `patients`. */
export const PatientProfilesLive = Layer.effect(
	PatientProfiles,
	Effect.gen(function* () {
		const db = yield* Db;
		return PatientProfiles.of({
			listFor: Effect.fn("PatientProfiles.listFor")(function* (userId: string) {
				return yield* Effect.promise(() => listPatientProfiles(db, userId));
			}),
			syncLinks: Effect.fn("PatientProfiles.syncLinks")(function* (userId: string) {
				const claimed = yield* Effect.promise(() => claimPatientInvites(db, userId));
				const matched = yield* Effect.promise(() => matchPatientsByCpf(db, userId));
				return claimed + matched;
			}),
		});
	}),
);

/** A link as the doctor sees it: who it is for and where it stands. */
export interface PatientLink {
	readonly id: number;
	/** Invite address, or the linked account's email once claimed. */
	readonly email: string;
	readonly relation: string;
	readonly status: string;
	readonly source: string;
}

/** A patient's links, without revoked ones (history). */
export async function listPatientLinks(db: DbClient, patientId: number): Promise<PatientLink[]> {
	const rows = await db
		.select({
			id: patientAccess.id,
			inviteEmail: patientAccess.email,
			accountEmail: user.email,
			relation: patientAccess.relation,
			status: patientAccess.status,
			source: patientAccess.source,
		})
		.from(patientAccess)
		.leftJoin(user, eq(patientAccess.userId, user.id))
		.where(and(eq(patientAccess.patientId, patientId), ne(patientAccess.status, "revoked")))
		.orderBy(asc(patientAccess.id));
	return rows.map(({ inviteEmail, accountEmail, ...row }) => ({
		...row,
		email: accountEmail ?? inviteEmail ?? "",
	}));
}

/**
 * Invite `email` to a patient record. When an account with that
 * *verified* email already exists the link is active at once; otherwise
 * it waits as "invited" until such an account opens the portal.
 * Re-inviting an address (or account) that already has a row reuses it.
 */
export async function invitePatientAccess(
	db: DbClient,
	input: {
		readonly patientId: number;
		readonly email: string;
		readonly relation: PatientAccessRelation;
		readonly grantedBy: string;
	},
): Promise<PatientAccess> {
	const [account] = await db
		.select({ id: user.id, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.email, input.email));
	const userId = account?.emailVerified ? account.id : null;
	const link = {
		userId,
		email: input.email,
		relation: input.relation,
		status: userId === null ? "invited" : "active",
		source: "invite",
		grantedBy: input.grantedBy,
	};
	const [existing] = await db
		.select({ id: patientAccess.id })
		.from(patientAccess)
		.where(
			and(
				eq(patientAccess.patientId, input.patientId),
				userId === null
					? eq(patientAccess.email, input.email)
					: or(eq(patientAccess.userId, userId), eq(patientAccess.email, input.email)),
			),
		);
	const [row] =
		existing === undefined
			? await db
					.insert(patientAccess)
					.values({ patientId: input.patientId, ...link })
					.returning()
			: await db
					.update(patientAccess)
					.set(link)
					.where(eq(patientAccess.id, existing.id))
					.returning();
	return row!;
}

/** Set a link's status when it belongs to a patient of `ownerId`;
 * `from` restricts which current status may change. */
async function setLinkStatus(
	db: DbClient,
	input: {
		readonly ownerId: string;
		readonly id: number;
		readonly status: "active" | "revoked";
		readonly from?: string;
		readonly grantedBy: string;
	},
): Promise<boolean> {
	const [link] = await db
		.select({ id: patientAccess.id, status: patientAccess.status })
		.from(patientAccess)
		.innerJoin(patients, eq(patientAccess.patientId, patients.id))
		.where(and(eq(patientAccess.id, input.id), eq(patients.ownerId, input.ownerId)));
	if (link === undefined || (input.from !== undefined && link.status !== input.from)) return false;
	await db
		.update(patientAccess)
		.set({ status: input.status, grantedBy: input.grantedBy })
		.where(eq(patientAccess.id, link.id));
	return true;
}

/** Why an invite was refused — codes on the wire, copy in the view. */
export type PatientInviteErrorCode = "invalid_email" | "invalid_relation";

export class PatientInviteRejected extends Data.TaggedError("PatientInviteRejected")<{
	readonly code: PatientInviteErrorCode;
}> {}

/**
 * Patient links domain port — the doctor side of portal access: who may
 * open a patient record. Every operation is scoped to patients owned by
 * the bound principal's doctor (`Principal.userId`), so a secretary
 * acting for the doctor manages them too; the acting person is recorded
 * as `granted_by`. Fails `Forbidden` without a principal or for a
 * patient the doctor does not own.
 */
export class PatientLinks extends Context.Service<
	PatientLinks,
	{
		readonly list: (patientId: number) => Effect.Effect<PatientLink[], Forbidden>;
		readonly invite: (input: {
			readonly patientId: number;
			readonly email: string;
			readonly relation: string;
		}) => Effect.Effect<PatientAccess, Forbidden | PatientInviteRejected>;
		/** Approve a pending CPF match; false when there is none to approve. */
		readonly approve: (id: number) => Effect.Effect<boolean, Forbidden>;
		readonly revoke: (id: number) => Effect.Effect<boolean, Forbidden>;
	}
>()("@ktb/patient-access/PatientLinks") {}

export const PatientLinksLive = Layer.effect(
	PatientLinks,
	Effect.gen(function* () {
		const db = yield* Db;
		const principalOr = (path: string) =>
			Effect.flatMap(Principal, (principal) =>
				principal === null ? Effect.fail(new Forbidden({ path })) : Effect.succeed(principal),
			);
		/** The principal, once `patientId` is confirmed to be their doctor's. */
		const ownerOf = (patientId: number, path: string) =>
			Effect.gen(function* () {
				const principal = yield* principalOr(path);
				const [owned] = yield* Effect.promise(() =>
					db
						.select({ id: patients.id })
						.from(patients)
						.where(and(eq(patients.id, patientId), eq(patients.ownerId, principal.userId))),
				);
				if (owned === undefined) return yield* Effect.fail(new Forbidden({ path }));
				return principal;
			});
		return PatientLinks.of({
			list: Effect.fn("PatientLinks.list")(function* (patientId: number) {
				yield* ownerOf(patientId, "patient-access.read");
				return yield* Effect.promise(() => listPatientLinks(db, patientId));
			}),
			invite: Effect.fn("PatientLinks.invite")(function* (input) {
				const principal = yield* ownerOf(input.patientId, "patient-access.invite");
				const email = normalizeEmail(input.email);
				if (!EMAIL_SHAPE.test(email)) {
					return yield* Effect.fail(new PatientInviteRejected({ code: "invalid_email" }));
				}
				const relation = PATIENT_ACCESS_RELATIONS.find((r) => r === input.relation);
				if (relation === undefined) {
					return yield* Effect.fail(new PatientInviteRejected({ code: "invalid_relation" }));
				}
				return yield* Effect.promise(() =>
					invitePatientAccess(db, {
						patientId: input.patientId,
						email,
						relation,
						grantedBy: principal.actorId ?? principal.userId,
					}),
				);
			}),
			approve: Effect.fn("PatientLinks.approve")(function* (id: number) {
				const principal = yield* principalOr("patient-access.approve");
				return yield* Effect.promise(() =>
					setLinkStatus(db, {
						ownerId: principal.userId,
						id,
						status: "active",
						from: "pending",
						grantedBy: principal.actorId ?? principal.userId,
					}),
				);
			}),
			revoke: Effect.fn("PatientLinks.revoke")(function* (id: number) {
				const principal = yield* principalOr("patient-access.revoke");
				return yield* Effect.promise(() =>
					setLinkStatus(db, {
						ownerId: principal.userId,
						id,
						status: "revoked",
						grantedBy: principal.actorId ?? principal.userId,
					}),
				);
			}),
		});
	}),
);

export const patientAccessTablesPlugin = definePlugin({
	id: "patient-access.tables",
	tables: { patientAccess },
});

export const patientAccessServicesPlugin = definePlugin({
	id: "patient-access.services",
	services: Layer.mergeAll(PatientProfilesLive, PatientLinksLive),
});

// Route subtree composed into the host's virtualRouteConfig: the route
// modules live in THIS package (src/routes/**), discovered by a
// physical() directory scan relative to the host's routes directory.
export const patientAccessRoutesPlugin = definePlugin({
	id: "patient-access.routes",
	routes: [physical("/patient-access", "../../../../plugins/patient-access/src/routes")],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	patientAccessTablesPlugin,
	patientAccessServicesPlugin,
	patientAccessRoutesPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"patient-access.tables": true;
		"patient-access.services": true;
		"patient-access.routes": true;
	}
}

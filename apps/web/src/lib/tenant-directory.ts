import * as Effect from "effect/Effect";
import { and, asc, eq } from "drizzle-orm";

import type { DbClient } from "@ktb/db";
import { groupMembers, groups } from "@ktb/db/schema";
import {
	isEmptySelector,
	type Tenant,
	type TenantDirectoryShape,
	type TenantMembership,
	type TenantRole,
	type TenantSelector,
} from "@ktb/tenant";

/**
 * TenantDirectory adapter (P-053, phase A — resolution only).
 *
 * Tenant membership is stored in the groups plugin's tables
 * (`groups` + `group_members`, memberKind="user"): each group is a
 * tenant, `kind` is the tenant kind, `slug`/`meta` map onto the
 * TenantDescriptor fields, and the member row's free-form `role`
 * normalizes onto the built-in TenantRole set.
 *
 * This is an edge adapter: the groups service is PlatformAdmin-gated,
 * so member lookups must not route through it — same precedent as
 * `Patients.adminOwners`/`listOwnerOptions` reading the auth users
 * table directly. The tables are imported from `@ktb/db/schema` (the
 * composed drizzle schema), never from the plugin's service layer.
 */

/**
 * groups.group_members.role is free-form ("lead", "mod", …). Only the
 * three built-in tenant roles survive normalization; anything else —
 * including NULL — resolves to "member", the least-privileged grant.
 */
const TENANT_ROLES: Readonly<Record<string, TenantRole>> = {
	owner: "owner",
	admin: "admin",
	member: "member",
};

const normalizeRole = (role: string | null): TenantRole =>
	role === null ? "member" : (TENANT_ROLES[role.trim().toLowerCase()] ?? "member");

/** groups.meta is a JSON text column; absent or malformed payloads map
 * to `undefined` rather than leaking a raw string into the descriptor. */
const parseMeta = (meta: string | null): unknown => {
	if (meta === null) return undefined;
	try {
		return JSON.parse(meta);
	} catch {
		return undefined;
	}
};

const toMembership = (row: {
	readonly group: typeof groups.$inferSelect;
	readonly member: typeof groupMembers.$inferSelect;
}): TenantMembership => ({
	tenant: {
		// groups.id is an integer PK — TenantDescriptor.id admits
		// string | number; the numeric id is the canonical form.
		id: row.group.id,
		kind: row.group.kind,
		slug: row.group.slug,
		meta: parseMeta(row.group.meta),
	},
	role: normalizeRole(row.member.role),
});

/** Every tenant the user can act in, ordered by group id for a
 * deterministic default pick. Membership-scoped by construction: only
 * rows where the user is a "user" member are returned. */
const listMemberships = (db: DbClient, userId: string) =>
	db
		.select({ group: groups, member: groupMembers })
		.from(groupMembers)
		.innerJoin(groups, eq(groupMembers.groupId, groups.id))
		.where(and(eq(groupMembers.memberKind, "user"), eq(groupMembers.memberId, userId)))
		.orderBy(asc(groups.id));

/**
 * Selector match against one membership. Every present selector field
 * must hold (AND semantics — an inconsistent selector matches nothing);
 * `raw` is the escape hatch matching either slug or the id rendered as
 * a string (headers arrive as text, so numeric ids compare by string).
 */
const matchesSelector = (membership: TenantMembership, selector: TenantSelector): boolean => {
	const tenant = membership.tenant;
	if (selector.slug !== undefined && tenant.slug !== selector.slug) return false;
	if (selector.id !== undefined && String(tenant.id) !== String(selector.id)) return false;
	if (selector.kind !== undefined && tenant.kind !== selector.kind) return false;
	if (selector.raw !== undefined) {
		// Raw arrives as header text — strings match directly, numbers
		// compare by their decimal form; anything else never matches.
		const raw =
			typeof selector.raw === "string"
				? selector.raw
				: typeof selector.raw === "number"
					? String(selector.raw)
					: null;
		if (raw === null || (raw !== tenant.slug && raw !== String(tenant.id))) return false;
	}
	return true;
};

/**
 * Build the {@link TenantDirectoryShape} over the app's drizzle client.
 * Pure reads — no caching: resolution happens per request inside the
 * runAs scope, so membership changes take effect immediately.
 */
export const makeTenantDirectory = (db: DbClient): TenantDirectoryShape => {
	const membershipsFor = (userId: string) =>
		Effect.tryPromise({
			try: async () => (await listMemberships(db, userId)).map(toMembership),
			catch: (error) => error,
		});
	return {
		membershipsFor,
		findBySelector: (userId, selector) =>
			Effect.gen(function* () {
				if (isEmptySelector(selector)) return null;
				const memberships = yield* membershipsFor(userId);
				const match = memberships.find((membership) => matchesSelector(membership, selector));
				if (match === undefined) return null;
				const tenant: Tenant = { ...match.tenant, role: match.role };
				return tenant;
			}),
	};
};

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { and, desc, eq, sql } from "drizzle-orm";
import { ShieldCheckIcon } from "lucide-react";

import { Forbidden, Principal } from "@ktb/authz";
import { audit, auditServicesPlugin } from "@ktb/audit";
import { Db, type DbClient } from "@ktb/db";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { PlatformAdmin, platformAdminPlugin, platformPanelPlugin } from "@ktb/platform";
import {
	bumpEpoch,
	GroupMembership,
	PermissionInvalidator,
	permissionsService,
	Permissions,
	PERMISSION_CATALOG,
	splitPermission,
	subjectRoles,
	rolePermissions,
	roles,
	permissionEpoch,
	type PermissionEffect,
	type Role,
	type RolePermission,
	type SubjectKind,
	type SubjectRole,
} from "@ktb/rbac";
import { Command, Query } from "@effect-server-utils/cqrs";

import { RbacCommands, RbacQueries } from "./api.ts";
import { RbacPlatformPage } from "./platform-page.tsx";

// ---------- row shapes ----------

export type { Role, RolePermission, SubjectRole };

export interface AssignmentRow extends SubjectRole {
	readonly roleName: string;
}

/** Wire shapes mirroring api.ts schemas — what the panel page
 * receives as loader `data` (dates survive JSON as ISO strings on
 * the client; the view only formats them). */
export interface RoleWire {
	readonly id: number;
	readonly name: string;
	readonly description: string | null;
	readonly meta: string | null;
	readonly createdAt: Date;
}

export interface RolePermissionWire {
	readonly id: number;
	readonly roleId: number;
	readonly resource: string;
	readonly action: string;
	readonly effect: PermissionEffect;
}

export interface RoleDetailWire {
	readonly role: RoleWire;
	readonly permissions: readonly RolePermissionWire[];
}

export interface AdminRbacPageData {
	readonly roles: readonly RoleWire[];
	readonly details: readonly RoleDetailWire[];
	readonly assignments: readonly AssignmentRow[];
	readonly catalog: readonly { key: string; resource: string; action: string }[];
}

// ---------- repo functions (async, DbClient — same contract as
// plugins/groups: callers MUST have passed the PlatformAdmin gate) ----------

const toRoleRow = (r: Role) => ({
	id: r.id,
	name: r.name,
	description: r.description,
	meta: r.meta,
	createdAt: r.createdAt,
});

export async function listRoles(db: DbClient): Promise<Role[]> {
	return db.select().from(roles).orderBy(roles.name);
}

export async function getRole(db: DbClient, id: number): Promise<Role | null> {
	const rows = await db.select().from(roles).where(eq(roles.id, id));
	return rows[0] ?? null;
}

export async function listRolePermissions(db: DbClient, roleId: number) {
	return db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
}

export async function listAssignments(db: DbClient): Promise<AssignmentRow[]> {
	const rows = await db
		.select({ assignment: subjectRoles, roleName: roles.name })
		.from(subjectRoles)
		.innerJoin(roles, eq(roles.id, subjectRoles.roleId))
		.orderBy(desc(subjectRoles.id));
	return rows.map((r) => ({ ...r.assignment, roleName: r.roleName }));
}

export async function createRole(
	db: DbClient,
	input: { name: string; description?: string | null; meta?: string | null },
): Promise<Role | null> {
	const rows = await db
		.insert(roles)
		.values({
			name: input.name,
			description: input.description ?? null,
			meta: input.meta ?? null,
		})
		.returning();
	return rows[0] ?? null;
}

export async function updateRole(
	db: DbClient,
	input: { id: number; name?: string; description?: string | null; meta?: string | null },
): Promise<Role | null> {
	const patch: Partial<typeof roles.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.meta !== undefined) patch.meta = input.meta;
	if (Object.keys(patch).length === 0) return getRole(db, input.id);
	const rows = await db.update(roles).set(patch).where(eq(roles.id, input.id)).returning();
	return rows[0] ?? null;
}

export async function deleteRole(db: DbClient, id: number): Promise<void> {
	await db.delete(roles).where(eq(roles.id, id));
}

export async function setRolePermission(
	db: DbClient,
	input: { roleId: number; resource: string; action: string; effect: PermissionEffect },
): Promise<void> {
	await db
		.insert(rolePermissions)
		.values({
			roleId: input.roleId,
			resource: input.resource,
			action: input.action,
			effect: input.effect,
		})
		.onConflictDoUpdate({
			target: [rolePermissions.roleId, rolePermissions.resource, rolePermissions.action],
			set: { effect: input.effect },
		});
}

export async function revokeRolePermission(
	db: DbClient,
	input: { roleId: number; resource: string; action: string },
): Promise<void> {
	await db
		.delete(rolePermissions)
		.where(
			and(
				eq(rolePermissions.roleId, input.roleId),
				eq(rolePermissions.resource, input.resource),
				eq(rolePermissions.action, input.action),
			),
		);
}

const normalizeExpiresAt = (input: Date | string | number | null | undefined): Date | null => {
	if (input === null || input === undefined) return null;
	const d = input instanceof Date ? input : new Date(input);
	return Number.isNaN(d.getTime()) ? null : d;
};

/** Find an existing assignment for the same (subject, role, tenant)
 * triple — tenant NULL matches only NULL (SQL `=` never matches NULL,
 * so global grants are checked separately). */
async function findAssignment(
	db: DbClient,
	input: {
		subjectKind: SubjectKind;
		subjectId: string;
		roleId: number;
		tenantId?: string | number | null;
	},
): Promise<SubjectRole | null> {
	// TEXT column; P-053 tenant ids are string|number — normalize.
	const tenantId = input.tenantId == null ? null : String(input.tenantId);
	const rows = await db
		.select()
		.from(subjectRoles)
		.where(
			and(
				eq(subjectRoles.subjectKind, input.subjectKind),
				eq(subjectRoles.subjectId, input.subjectId),
				eq(subjectRoles.roleId, input.roleId),
				tenantId === null
					? sql`${subjectRoles.tenantId} is null`
					: eq(subjectRoles.tenantId, tenantId),
			),
		);
	return rows[0] ?? null;
}

export async function assignSubject(
	db: DbClient,
	input: {
		subjectKind: SubjectKind;
		subjectId: string;
		roleId: number;
		tenantId?: string | number | null;
		expiresAt?: Date | string | number | null;
		grantedBy?: string | null;
	},
): Promise<AssignmentRow | null> {
	const expiresAt = normalizeExpiresAt(input.expiresAt);
	const existing = await findAssignment(db, input);
	let row: SubjectRole | undefined;
	if (existing !== null) {
		// Re-assigning the same triple refreshes expiry/granter in place.
		const rows = await db
			.update(subjectRoles)
			.set({ expiresAt, grantedBy: input.grantedBy ?? existing.grantedBy })
			.where(eq(subjectRoles.id, existing.id))
			.returning();
		row = rows[0];
	} else {
		const rows = await db
			.insert(subjectRoles)
			.values({
				subjectKind: input.subjectKind,
				subjectId: input.subjectId,
				roleId: input.roleId,
				tenantId: input.tenantId == null ? null : String(input.tenantId),
				grantedBy: input.grantedBy ?? null,
				expiresAt,
			})
			.returning();
		row = rows[0];
	}
	if (row === undefined) return null;
	const role = await getRole(db, row.roleId);
	return { ...row, roleName: role?.name ?? "" };
}

export async function unassignSubject(db: DbClient, id: number): Promise<void> {
	await db.delete(subjectRoles).where(eq(subjectRoles.id, id));
}

/** Single assignment lookup by row id — the audit path reads the row
 * before `unassignSubject` deletes it. */
export async function getSubjectRole(db: DbClient, id: number): Promise<SubjectRole | null> {
	const rows = await db.select().from(subjectRoles).where(eq(subjectRoles.id, id));
	return rows[0] ?? null;
}

/**
 * Group ids a user belongs to, read straight off the groups plugin's
 * `group_members` table over raw SQL — plugins never import each
 * other, so the membership shape is duplicated here as a read-only
 * contract (member_kind='user', member_id=userId → group_id).
 */
export async function groupIdsForUser(db: DbClient, userId: string): Promise<string[]> {
	const rows = await db.all<{ group_id: number }>(
		sql`select group_id from group_members where member_kind = 'user' and member_id = ${userId}`,
	);
	return rows.map((r) => String(r.group_id));
}

// ---------- services ----------

const GroupMembershipLive = Layer.effect(
	GroupMembership,
	Effect.gen(function* () {
		const db = yield* Db;
		return GroupMembership.of({
			groupIdsFor: (userId) => Effect.promise(() => groupIdsForUser(db, userId)),
		});
	}),
);

/** `Permissions` + `PermissionInvalidator` sharing one instance — the
 * invalidator is what write paths in OTHER plugins (groups membership)
 * call to bump the epoch. `GroupMembershipLive` is provided INTO the
 * permissions build (not merged beside it): `permissionsService`
 * resolves the port via `serviceOption` at layer-build time, and
 * sibling layers in a `mergeAll` are invisible to each other. */
const RbacPermissionsLive = Layer.unwrap(
	Effect.map(permissionsService, (permissions) =>
		Layer.mergeAll(
			Layer.succeed(Permissions, permissions),
			Layer.succeed(
				PermissionInvalidator,
				PermissionInvalidator.of({ invalidate: () => permissions.invalidate() }),
			),
		),
	),
).pipe(Layer.provide(GroupMembershipLive));

/** Every mutating handler bumps the permission epoch so cached grant
 * sets re-resolve on the next request. */
const withEpoch = <A, E, R>(write: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const db = yield* Db;
		const result = yield* write;
		yield* Effect.promise(() => bumpEpoch(db));
		return result;
	});

const requireAdmin = Effect.gen(function* () {
	const platformAdmin = yield* PlatformAdmin;
	yield* platformAdmin.requireAdmin();
});

export const RbacQueriesLive = Query.handlersOf(RbacQueries, {
	"rbac.catalog": () =>
		Effect.gen(function* () {
			yield* requireAdmin;
			return PERMISSION_CATALOG.map((key) => {
				const { resource, action } = splitPermission(key);
				return { key, resource, action };
			});
		}),
	"rbac.roles": () =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			const rows = yield* Effect.promise(() => listRoles(db));
			return rows.map(toRoleRow);
		}),
	"rbac.role": ({ id }) =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			const role = yield* Effect.promise(() => getRole(db, id));
			if (role === null) return null;
			const perms = yield* Effect.promise(() => listRolePermissions(db, id));
			return {
				role: toRoleRow(role),
				permissions: perms.map((p) => ({
					id: p.id,
					roleId: p.roleId,
					resource: p.resource,
					action: p.action,
					effect: p.effect as PermissionEffect,
				})),
			};
		}),
	"rbac.assignments": () =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			const rows = yield* Effect.promise(() => listAssignments(db));
			return rows.map((r) => ({
				id: r.id,
				subjectKind: r.subjectKind as SubjectKind,
				subjectId: r.subjectId,
				roleId: r.roleId,
				roleName: r.roleName,
				tenantId: r.tenantId,
				grantedBy: r.grantedBy,
				expiresAt: r.expiresAt,
			}));
		}),
});

const grantedBy = Effect.gen(function* () {
	const principal = yield* Principal;
	return principal?.userId ?? null;
});

export const RbacCommandsLive = Command.handlersOf(RbacCommands, {
	"rbac.createRole": ({ name, description, meta }) =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			const row = yield* withEpoch(
				Effect.promise(() => createRole(db, { name, description, meta })),
			);
			if (row === null) {
				return yield* Effect.fail(new Forbidden({ path: "rbac.createRole" }));
			}
			yield* audit({
				action: "rbac.role.create",
				targetType: "role",
				targetId: row.id,
				detail: { name: row.name },
			});
			return toRoleRow(row);
		}),
	"rbac.updateRole": ({ id, name, description, meta }) =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			const row = yield* withEpoch(
				Effect.promise(() => updateRole(db, { id, name, description, meta })),
			);
			if (row !== null) {
				// Only the provided fields land in detail — JSON.stringify
				// drops the undefined keys.
				yield* audit({
					action: "rbac.role.update",
					targetType: "role",
					targetId: id,
					detail: { name, description, meta },
				});
			}
			return row === null ? null : toRoleRow(row);
		}),
	"rbac.deleteRole": ({ id }) =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			yield* withEpoch(Effect.promise(() => deleteRole(db, id)));
			yield* audit({ action: "rbac.role.delete", targetType: "role", targetId: id });
		}),
	"rbac.setRolePermission": ({ roleId, resource, action, effect }) =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			// Role must exist — grants on dangling roles resolve to nothing.
			const role = yield* Effect.promise(() => getRole(db, roleId));
			if (role === null) {
				return yield* Effect.fail(new Forbidden({ path: "rbac.setRolePermission" }));
			}
			yield* withEpoch(
				Effect.promise(() => setRolePermission(db, { roleId, resource, action, effect })),
			);
			yield* audit({
				action: "rbac.permission.set",
				targetType: "role",
				targetId: roleId,
				detail: { resource, action, effect },
			});
		}),
	"rbac.revokeRolePermission": ({ roleId, resource, action }) =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			yield* withEpoch(
				Effect.promise(() => revokeRolePermission(db, { roleId, resource, action })),
			);
			yield* audit({
				action: "rbac.permission.revoke",
				targetType: "role",
				targetId: roleId,
				detail: { resource, action },
			});
		}),
	"rbac.assignSubject": ({ subjectKind, subjectId, roleId, tenantId, expiresAt }) =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			const by = yield* grantedBy;
			const role = yield* Effect.promise(() => getRole(db, roleId));
			if (role === null) {
				return yield* Effect.fail(new Forbidden({ path: "rbac.assignSubject" }));
			}
			const row = yield* withEpoch(
				Effect.promise(() =>
					assignSubject(db, {
						subjectKind,
						subjectId,
						roleId,
						tenantId,
						expiresAt,
						grantedBy: by,
					}),
				),
			);
			if (row === null) {
				return yield* Effect.fail(new Forbidden({ path: "rbac.assignSubject" }));
			}
			yield* audit({
				action: "rbac.subject.assign",
				targetType: "subject_role",
				targetId: row.id,
				tenantId: row.tenantId,
				detail: {
					subjectKind: row.subjectKind,
					subjectId: row.subjectId,
					roleId: row.roleId,
					roleName: row.roleName,
				},
			});
			return {
				id: row.id,
				subjectKind: row.subjectKind as SubjectKind,
				subjectId: row.subjectId,
				roleId: row.roleId,
				roleName: row.roleName,
				tenantId: row.tenantId,
				grantedBy: row.grantedBy,
				expiresAt: row.expiresAt,
			};
		}),
	"rbac.unassignSubject": ({ id }) =>
		Effect.gen(function* () {
			yield* requireAdmin;
			const db = yield* Db;
			// Read before delete — the audit detail names what was revoked.
			const before = yield* Effect.promise(() => getSubjectRole(db, id));
			yield* withEpoch(Effect.promise(() => unassignSubject(db, id)));
			yield* audit({
				action: "rbac.subject.unassign",
				targetType: "subject_role",
				targetId: id,
				tenantId: before?.tenantId ?? null,
				detail:
					before === null
						? null
						: {
								subjectKind: before.subjectKind,
								subjectId: before.subjectId,
								roleId: before.roleId,
							},
			});
		}),
});

export const rbacServicesPlugin = definePlugin({
	id: "rbac.services",
	// Admin ops consume the PlatformAdmin gate — the dep edge keeps the
	// platform module ordered (and discovered) before this plugin's layer.
	requiredDeps: [platformAdminPlugin.id],
	// Audit writes resolve the Audit service via serviceOption — the dep
	// edge is an ordering hint only; absence is legal.
	optionalDeps: [auditServicesPlugin.id],
	services: Layer.mergeAll(
		RbacPermissionsLive,
		GroupMembershipLive,
		RbacQueriesLive,
		RbacCommandsLive,
	),
});

export const rbacTablesPlugin = definePlugin({
	id: "rbac.tables",
	tables: {
		roles,
		rolePermissions,
		subjectRoles,
		permissionEpoch,
	},
});

// Panel (system console) contribution: /platform/roles is mounted by
// the platform plugin's physical route subtree; this plugin declares
// the sidebar entry + page descriptor.
export const rbacPanelPlugin = definePlugin({
	id: "rbac.panel",
	requiredDeps: [platformPanelPlugin.id],
	panel: {
		sidebar: [{ to: "/platform/roles", label: "Roles", icon: ShieldCheckIcon, group: "Access" }],
		pages: [
			{
				id: "rbac.admin",
				path: "/platform/roles",
				component: RbacPlatformPage,
				// Cross-owner admin data — every query re-checks the
				// PlatformAdmin gate; Forbidden collapses to the empty
				// console like the other admin pages.
				loader: () =>
					// `Query.dispatcher` requires `Scope` — `runAs` does not
					// provide one, so the dispatch surface is built inside a
					// scoped region like the server fns do.
					Effect.scoped(
						Effect.gen(function* () {
							const queries = yield* Query.dispatcher(RbacQueries);
							const empty: AdminRbacPageData = {
								roles: [],
								details: [],
								assignments: [],
								catalog: [],
							};
							return yield* Effect.gen(function* () {
								const [roles, assignments, catalog] = yield* Effect.all([
									queries["rbac.roles"]({}),
									queries["rbac.assignments"]({}),
									queries["rbac.catalog"]({}),
								]);
								const details = yield* Effect.forEach(roles, (r) =>
									queries["rbac.role"]({ id: r.id }),
								);
								return {
									roles,
									details: details.filter((d) => d !== null),
									assignments,
									catalog,
								};
							}).pipe(Effect.catchTag("Forbidden", () => Effect.succeed(empty)));
						}),
					),
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [rbacTablesPlugin, rbacServicesPlugin, rbacPanelPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"rbac.tables": true;
		"rbac.services": true;
		"rbac.panel": true;
	}
}

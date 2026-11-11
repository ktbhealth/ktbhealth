import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { and, count, desc, eq } from "drizzle-orm";
import { BoxesIcon } from "lucide-react";

import { audit, auditServicesPlugin } from "@ktb/audit";
import { Forbidden, Principal } from "@ktb/authz";
import { Db, type DbClient } from "@ktb/db";
import { PermissionInvalidator } from "@ktb/rbac";
import { rbacServicesPlugin } from "@ktb/rbac-plugin";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { PlatformAdmin, platformAdminPlugin, platformPanelPlugin } from "@ktb/platform";
import { Query } from "@effect-server-utils/cqrs";

import { GroupsQueries } from "./api.ts";
import { GroupsPlatformPage } from "./platform-page.tsx";
import { groupMembers, groups } from "./schema.ts";

export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;

/** Console row: group plus its member count resolved by the repo. */
export interface AdminGroupRow extends Group {
	readonly memberCount: number;
}

export interface CreateGroupInput {
	readonly name: string;
	readonly slug: string;
	readonly kind: string;
	/** Optional JSON payload stored as text. */
	readonly meta?: string | null;
}

export interface AddGroupMemberInput {
	readonly groupId: number;
	readonly memberKind: string;
	readonly memberId: string;
	readonly role?: string | null;
}

export interface RemoveGroupMemberInput {
	readonly groupId: number;
	readonly memberKind: string;
	readonly memberId: string;
}

export interface UpdateGroupMemberRoleInput {
	readonly groupId: number;
	readonly memberKind: string;
	readonly memberId: string;
	/** `null` clears the role back to the column default. */
	readonly role: string | null;
}

export async function createGroup(db: DbClient, input: CreateGroupInput) {
	const rows = await db
		.insert(groups)
		.values({
			name: input.name,
			slug: input.slug,
			kind: input.kind,
			meta: input.meta ?? null,
		})
		.returning();
	return rows[0] ?? null;
}

/**
 * Cross-owner group listing for the /platform console. Callers MUST have
 * passed the `PlatformAdmin` gate first — this repo function itself is
 * unauthenticated, like the other `*Groups` helpers.
 */
export async function listGroups(db: DbClient): Promise<AdminGroupRow[]> {
	const [rows, memberCounts] = await Promise.all([
		db.select().from(groups).orderBy(desc(groups.id)),
		db
			.select({ groupId: groupMembers.groupId, n: count() })
			.from(groupMembers)
			.groupBy(groupMembers.groupId),
	]);
	const counts = new Map(memberCounts.map((r) => [r.groupId, r.n]));
	return rows.map((g) => ({ ...g, memberCount: counts.get(g.id) ?? 0 }));
}

/**
 * Deletes a group row; `group_members` rows cascade via the FK. Returns
 * false when no group with that id exists.
 */
export async function deleteGroup(db: DbClient, id: number): Promise<boolean> {
	const rows = await db.delete(groups).where(eq(groups.id, id)).returning({ id: groups.id });
	return rows.length > 0;
}

export async function getGroup(db: DbClient, id: number): Promise<Group | null> {
	const rows = await db.select().from(groups).where(eq(groups.id, id));
	return rows[0] ?? null;
}

async function countGroupMembers(db: DbClient, groupId: number): Promise<number> {
	const rows = await db
		.select({ n: count() })
		.from(groupMembers)
		.where(eq(groupMembers.groupId, groupId));
	return rows[0]?.n ?? 0;
}

export async function addMember(db: DbClient, input: AddGroupMemberInput) {
	const rows = await db
		.insert(groupMembers)
		.values({
			groupId: input.groupId,
			memberKind: input.memberKind,
			memberId: input.memberId,
			role: input.role ?? null,
		})
		.returning();
	return rows[0] ?? null;
}

export async function findMembership(
	db: DbClient,
	groupId: number,
	memberKind: string,
	memberId: string,
) {
	const rows = await db
		.select()
		.from(groupMembers)
		.where(
			and(
				eq(groupMembers.groupId, groupId),
				eq(groupMembers.memberKind, memberKind),
				eq(groupMembers.memberId, memberId),
			),
		);
	return rows[0] ?? null;
}

export async function removeMember(db: DbClient, input: RemoveGroupMemberInput) {
	const existing = await findMembership(db, input.groupId, input.memberKind, input.memberId);
	if (existing === null) return null;
	await db
		.delete(groupMembers)
		.where(
			and(
				eq(groupMembers.groupId, input.groupId),
				eq(groupMembers.memberKind, input.memberKind),
				eq(groupMembers.memberId, input.memberId),
			),
		);
	return existing;
}

/**
 * Updates the `role` column of an existing membership; returns the
 * updated row, or null when no such membership exists.
 */
export async function updateMemberRole(db: DbClient, input: UpdateGroupMemberRoleInput) {
	const existing = await findMembership(db, input.groupId, input.memberKind, input.memberId);
	if (existing === null) return null;
	const rows = await db
		.update(groupMembers)
		.set({ role: input.role })
		.where(
			and(
				eq(groupMembers.groupId, input.groupId),
				eq(groupMembers.memberKind, input.memberKind),
				eq(groupMembers.memberId, input.memberId),
			),
		)
		.returning();
	return rows[0] ?? existing;
}

export async function listMembers(db: DbClient, groupId: number) {
	return db
		.select()
		.from(groupMembers)
		.where(eq(groupMembers.groupId, groupId))
		.orderBy(groupMembers.id);
}

/**
 * Groups domain port — Effect service, swappable in tests.
 *
 * Admin-facing operations (`create`, `list`, `get`, `delete`,
 * `addMember`, `removeMember`, `members`) enforce the `PlatformAdmin` env-allowlist
 * gate against the bound `Principal` — defense in depth on top of the
 * /platform layout guard. `requireMember` is the member-scoped check for
 * future non-admin paths: for `memberKind === "user"` the bound
 * principal's userId must equal `memberId` and a membership row must
 * exist; other member kinds only require the membership row.
 */
export class Groups extends Context.Service<
	Groups,
	{
		readonly create: (input: CreateGroupInput) => Effect.Effect<Group | null, Forbidden>;
		readonly list: () => Effect.Effect<AdminGroupRow[], Forbidden>;
		readonly get: (id: number) => Effect.Effect<AdminGroupRow | null, Forbidden>;
		readonly delete: (id: number) => Effect.Effect<boolean, Forbidden>;
		readonly addMember: (
			input: AddGroupMemberInput,
		) => Effect.Effect<GroupMember | null, Forbidden>;
		readonly removeMember: (
			input: RemoveGroupMemberInput,
		) => Effect.Effect<GroupMember | null, Forbidden>;
		readonly updateMemberRole: (
			input: UpdateGroupMemberRoleInput,
		) => Effect.Effect<GroupMember | null, Forbidden>;
		readonly members: (groupId: number) => Effect.Effect<GroupMember[], Forbidden>;
		readonly requireMember: (
			groupId: number,
			memberKind: string,
			memberId: string,
		) => Effect.Effect<GroupMember, Forbidden>;
	}
>()("@ktb/groups/Groups") {}

export const GroupsLive = Layer.effect(
	Groups,
	Effect.gen(function* () {
		const db = yield* Db;
		const platformAdmin = yield* PlatformAdmin;
		// Optional: present only when the rbac plugin is deployed — its
		// absence must not break group writes (optionalDeps orders it
		// first when present).
		const invalidator = yield* Effect.serviceOption(PermissionInvalidator);
		const invalidatePermissions = Option.isSome(invalidator)
			? invalidator.value.invalidate
			: undefined;
		return Groups.of({
			create: Effect.fn("Groups.create")(function* (input: CreateGroupInput) {
				yield* platformAdmin.requireAdmin();
				const row = yield* Effect.promise(() => createGroup(db, input));
				if (row !== null) {
					// T-037: groups double as tenants — the new row's id is
					// both target and tenant scope.
					yield* audit({
						action: "groups.create",
						targetType: "group",
						targetId: row.id,
						tenantId: row.id,
						detail: { slug: row.slug, kind: row.kind },
					});
				}
				return row;
			}),
			list: Effect.fn("Groups.list")(function* () {
				yield* platformAdmin.requireAdmin();
				return yield* Effect.promise(() => listGroups(db));
			}),
			get: Effect.fn("Groups.get")(function* (id: number) {
				yield* platformAdmin.requireAdmin();
				const group = yield* Effect.promise(() => getGroup(db, id));
				if (group === null) return null;
				const memberCount = yield* Effect.promise(() => countGroupMembers(db, id));
				return { ...group, memberCount };
			}),
			delete: Effect.fn("Groups.delete")(function* (id: number) {
				yield* platformAdmin.requireAdmin();
				const deleted = yield* Effect.promise(() => deleteGroup(db, id));
				// Cascaded memberships feed RBAC group-derived grants — bump
				// the permission epoch like the member mutations do.
				if (deleted && invalidatePermissions !== undefined) yield* invalidatePermissions();
				if (deleted) {
					yield* audit({
						action: "groups.delete",
						targetType: "group",
						targetId: id,
						tenantId: id,
					});
				}
				return deleted;
			}),
			addMember: Effect.fn("Groups.addMember")(function* (input: AddGroupMemberInput) {
				yield* platformAdmin.requireAdmin();
				const member = yield* Effect.promise(() => addMember(db, input));
				// Membership feeds RBAC group-derived grants (P-054) — bump
				// the permission epoch so cached grant sets re-resolve.
				if (invalidatePermissions !== undefined) yield* invalidatePermissions();
				if (member !== null) {
					// Tenant member adds flow through here (Tenants facade)
					// — memberKind distinguishes user vs patient members.
					yield* audit({
						action: "groups.member.add",
						targetType: "group",
						targetId: input.groupId,
						tenantId: input.groupId,
						detail: {
							memberKind: input.memberKind,
							memberId: input.memberId,
							role: input.role ?? null,
						},
					});
				}
				return member;
			}),
			removeMember: Effect.fn("Groups.removeMember")(function* (input: RemoveGroupMemberInput) {
				yield* platformAdmin.requireAdmin();
				const member = yield* Effect.promise(() => removeMember(db, input));
				if (invalidatePermissions !== undefined) yield* invalidatePermissions();
				if (member !== null) {
					yield* audit({
						action: "groups.member.remove",
						targetType: "group",
						targetId: input.groupId,
						tenantId: input.groupId,
						detail: {
							memberKind: input.memberKind,
							memberId: input.memberId,
							role: member.role,
						},
					});
				}
				return member;
			}),
			updateMemberRole: Effect.fn("Groups.updateMemberRole")(function* (
				input: UpdateGroupMemberRoleInput,
			) {
				yield* platformAdmin.requireAdmin();
				const member = yield* Effect.promise(() => updateMemberRole(db, input));
				// Role changes feed RBAC group-derived grants — same epoch
				// bump as add/remove (P-054).
				if (member !== null && invalidatePermissions !== undefined) {
					yield* invalidatePermissions();
				}
				if (member !== null) {
					yield* audit({
						action: "groups.member.setRole",
						targetType: "group",
						targetId: input.groupId,
						tenantId: input.groupId,
						detail: {
							memberKind: input.memberKind,
							memberId: input.memberId,
							role: input.role,
						},
					});
				}
				return member;
			}),
			members: Effect.fn("Groups.members")(function* (groupId: number) {
				yield* platformAdmin.requireAdmin();
				return yield* Effect.promise(() => listMembers(db, groupId));
			}),
			requireMember: Effect.fn("Groups.requireMember")(function* (
				groupId: number,
				memberKind: string,
				memberId: string,
			) {
				if (memberKind === "user") {
					const principal = yield* Principal;
					if (principal === null || principal.userId !== memberId) {
						return yield* Effect.fail(new Forbidden({ path: "groups.member" }));
					}
				}
				const member = yield* Effect.promise(() =>
					findMembership(db, groupId, memberKind, memberId),
				);
				if (member === null) {
					return yield* Effect.fail(new Forbidden({ path: "groups.member" }));
				}
				return member;
			}),
		});
	}),
);

export const groupsTablesPlugin = definePlugin({
	id: "groups.tables",
	tables: { groups, groupMembers },
});

/** Cross-plugin query surface — raw group lookup for other plugins. */
export const GroupsQueriesLive = Query.handlersOf(GroupsQueries, {
	"groups.get": ({ id }) =>
		Effect.gen(function* () {
			const db = yield* Db;
			const rows = yield* Effect.promise(() =>
				db
					.select({
						id: groups.id,
						name: groups.name,
						slug: groups.slug,
						kind: groups.kind,
					})
					.from(groups)
					.where(eq(groups.id, id))
					.limit(1),
			);
			return rows[0] ?? null;
		}),
});

export const groupsServicesPlugin = definePlugin({
	id: "groups.services",
	// Admin ops consume the PlatformAdmin gate — the dep edge keeps the
	// platform module ordered (and discovered) before this plugin's layer.
	requiredDeps: [platformAdminPlugin.id],
	// Membership writes invalidate RBAC grants when the rbac plugin is
	// deployed — ordering hint only; absence is legal (serviceOption).
	optionalDeps: [rbacServicesPlugin.id, auditServicesPlugin.id],
	services: Layer.mergeAll(GroupsLive, GroupsQueriesLive),
});

// Panel (system console) contribution: /platform/groups is mounted by
// the platform plugin's physical route subtree; this plugin only
// declares the sidebar entry. The dep edge orders it after the shell.
export const groupsPanelPlugin = definePlugin({
	id: "groups.panel",
	requiredDeps: [platformPanelPlugin.id],
	panel: {
		sidebar: [{ to: "/platform/groups", label: "Groups", icon: BoxesIcon, group: "Access" }],
		pages: [
			{
				id: "groups.admin",
				path: "/platform/groups",
				component: GroupsPlatformPage,
				// Cross-owner listing for the console — the service
				// re-checks the PlatformAdmin gate; Forbidden collapses
				// to the same empty table the old server fn returned.
				loader: () =>
					Effect.gen(function* () {
						const groups = yield* Groups;
						return yield* groups
							.list()
							.pipe(Effect.catchTag("Forbidden", () => Effect.succeed([] as AdminGroupRow[])));
					}),
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	groupsTablesPlugin,
	groupsServicesPlugin,
	groupsPanelPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"groups.tables": true;
		"groups.services": true;
		"groups.panel": true;
	}
}

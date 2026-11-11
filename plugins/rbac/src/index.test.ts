import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Command, Query } from "@effect-server-utils/cqrs";
import { Principal } from "@ktb/authz";
import { Db, makeDb, type DbClient } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { GroupMembership, Permissions, PermissionInvalidator, readEpoch } from "@ktb/rbac";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { ShieldCheckIcon } from "lucide-react";

import {
	assignSubject,
	createRole,
	deleteRole,
	getRole,
	groupIdsForUser,
	listAssignments,
	listRolePermissions,
	listRoles,
	plugins,
	rbacPanelPlugin,
	rbacServicesPlugin,
	rbacTablesPlugin,
	revokeRolePermission,
	setRolePermission,
	unassignSubject,
	updateRole,
} from "./index.ts";
import { roles as rolesTable } from "@ktb/rbac/schema";
import { RbacCommands, RbacQueries } from "./api.ts";

const DDL = `
CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE role_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, resource TEXT NOT NULL, action TEXT NOT NULL, effect TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX role_permissions_role_resource_action_idx ON role_permissions (role_id, resource, action);
CREATE TABLE subject_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, tenant_id TEXT, granted_by TEXT, expires_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX subject_roles_subject_idx ON subject_roles (subject_kind, subject_id);
CREATE TABLE permission_epoch (id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0);
CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, member_kind TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT, created_at INTEGER NOT NULL);
INSERT INTO groups (id, name, slug, kind, meta, created_at, updated_at) VALUES (7, 'Clinic', 'clinic', 'clinic', NULL, 1, 1);
INSERT INTO group_members (group_id, member_kind, member_id, role, created_at) VALUES (7, 'user', 'u1', NULL, 1), (7, 'patient', 'p1', NULL, 1);
`;

const ADMIN = { userId: "admin@x.com", email: "admin@x.com" };
const MEMBER = { userId: "user@x.com", email: "user@x.com" };

const adminGate = makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"));

describe("rbac repo", () => {
	let db: DbClient;

	beforeAll(async () => {
		db = makeDb(makeD1(DDL));
	});

	it("role CRUD round-trips", async () => {
		const created = await createRole(db, {
			name: "nurse",
			description: "Ward",
			meta: '{"x":1}',
		});
		expect(created).not.toBeNull();
		expect(created!.name).toBe("nurse");
		expect((await listRoles(db)).map((r) => r.name)).toEqual(["nurse"]);

		const updated = await updateRole(db, { id: created!.id, description: "ICU" });
		expect(updated?.description).toBe("ICU");
		// No-op patch returns the row unchanged.
		const same = await updateRole(db, { id: created!.id });
		expect(same?.name).toBe("nurse");
		expect(await updateRole(db, { id: 999, name: "ghost" })).toBeNull();
		expect(await getRole(db, 999)).toBeNull();

		await deleteRole(db, created!.id);
		expect(await getRole(db, created!.id)).toBeNull();
	});

	it("setRolePermission upserts effect, revoke removes", async () => {
		const role = (await createRole(db, { name: "billing" }))!;
		await setRolePermission(db, {
			roleId: role.id,
			resource: "billing",
			action: "manage",
			effect: "allow",
		});
		let perms = await listRolePermissions(db, role.id);
		expect(perms).toHaveLength(1);
		expect(perms[0]?.effect).toBe("allow");

		// Same triple flips to deny in place.
		await setRolePermission(db, {
			roleId: role.id,
			resource: "billing",
			action: "manage",
			effect: "deny",
		});
		perms = await listRolePermissions(db, role.id);
		expect(perms).toHaveLength(1);
		expect(perms[0]?.effect).toBe("deny");

		await revokeRolePermission(db, {
			roleId: role.id,
			resource: "billing",
			action: "manage",
		});
		expect(await listRolePermissions(db, role.id)).toHaveLength(0);
		// Revoking a missing grant is a no-op.
		await revokeRolePermission(db, {
			roleId: role.id,
			resource: "billing",
			action: "manage",
		});
	});

	it("assignSubject inserts, refreshes and scopes by tenant", async () => {
		const role = (await createRole(db, { name: "auditor" }))!;
		const a1 = await assignSubject(db, {
			subjectKind: "user",
			subjectId: "u1",
			roleId: role.id,
			tenantId: null,
			expiresAt: null,
			grantedBy: "admin",
		});
		expect(a1?.roleName).toBe("auditor");
		expect(a1?.tenantId).toBeNull();

		// Same (subject, role, tenant) triple refreshes in place.
		const a2 = await assignSubject(db, {
			subjectKind: "user",
			subjectId: "u1",
			roleId: role.id,
			tenantId: null,
			expiresAt: "2030-01-01T00:00:00.000Z",
			grantedBy: "admin2",
		});
		expect(a2?.id).toBe(a1?.id);
		expect(a2?.expiresAt).toBeInstanceOf(Date);
		expect(a2?.grantedBy).toBe("admin2");

		// Numeric tenant id normalizes to the TEXT column.
		const a3 = await assignSubject(db, {
			subjectKind: "group",
			subjectId: "7",
			roleId: role.id,
			tenantId: 42,
		});
		expect(a3?.tenantId).toBe("42");

		// Garbage expiresAt normalizes to null (never expires).
		const a4 = await assignSubject(db, {
			subjectKind: "user",
			subjectId: "u2",
			roleId: role.id,
			expiresAt: "not-a-date",
		});
		expect(a4?.expiresAt).toBeNull();

		const assignments = await listAssignments(db);
		expect(assignments.length).toBeGreaterThanOrEqual(3);
		expect(assignments.every((a) => a.roleName === "auditor")).toBe(true);

		await unassignSubject(db, a1!.id);
		expect((await listAssignments(db)).some((a) => a.id === a1!.id)).toBe(false);
	});

	it("groupIdsForUser reads group_members without importing groups", async () => {
		expect(await groupIdsForUser(db, "u1")).toEqual(["7"]);
		expect(await groupIdsForUser(db, "nobody")).toEqual([]);
	});
});

describe("rbac services + CQRS", () => {
	let runtime: ManagedRuntime.ManagedRuntime<unknown, never>;
	let db: DbClient;

	const asUser = <A, E>(
		user: { userId: string; email?: string } | null,
		effect: Effect.Effect<A, E, unknown>,
	) =>
		runtime.runPromise(
			effect.pipe(
				Effect.provideService(
					Principal,
					user === null ? null : { userId: user.userId, email: user.email },
				),
			),
		);

	beforeAll(async () => {
		db = makeDb(makeD1(DDL));
		await db.insert(rolesTable).values({ name: "auditor", description: null, meta: null });
		const env = Layer.mergeAll(Layer.succeed(Db, db), Layer.succeed(PlatformAdmin, adminGate));
		// The plugin's services layer is type-erased (Layer.Any) — same
		// treatment the composition root gives it.
		const services = rbacServicesPlugin.services as Layer.Layer<unknown, unknown, unknown>;
		runtime = ManagedRuntime.make(
			services.pipe(Layer.provide(env)) as unknown as Layer.Layer<unknown, never, never>,
		);
	});

	afterAll(() => runtime.dispose());

	it("queries and commands enforce the PlatformAdmin gate", async () => {
		const program = Effect.gen(function* () {
			const queries = yield* Query.dispatcher(RbacQueries);
			return yield* queries["rbac.roles"]({});
		});
		// Non-admin principal → Forbidden.
		await expect(asUser(MEMBER, program.pipe(Effect.scoped))).rejects.toMatchObject({
			_tag: "Forbidden",
		});
		// Admin → rows.
		const rows = await asUser(ADMIN, program.pipe(Effect.scoped));
		expect(rows.map((r) => r.name)).toContain("auditor");
	});

	it("full role lifecycle through the command dispatcher", async () => {
		const out = await asUser(
			ADMIN,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(RbacCommands);
					const queries = yield* Query.dispatcher(RbacQueries);
					const role = yield* commands["rbac.createRole"]({
						name: "receptionist",
						description: "Front desk",
					});
					yield* commands["rbac.setRolePermission"]({
						roleId: role.id,
						resource: "patient",
						action: "read",
						effect: "allow",
					});
					const assignment = yield* commands["rbac.assignSubject"]({
						subjectKind: "user",
						subjectId: "u9",
						roleId: role.id,
						tenantId: "clinic-1",
					});
					const detail = yield* queries["rbac.role"]({ id: role.id });
					const assignments = yield* queries["rbac.assignments"]({});
					const catalog = yield* queries["rbac.catalog"]({});
					return { role, assignment, detail, assignments, catalog };
				}),
			),
		);
		expect(out.role.name).toBe("receptionist");
		expect(out.assignment.grantedBy).toBe("admin@x.com");
		expect(out.assignment.tenantId).toBe("clinic-1");
		expect(out.detail?.permissions).toHaveLength(1);
		expect(out.assignments.some((a) => a.id === out.assignment.id)).toBe(true);
		expect(out.catalog.some((c) => c.key === "patient.read")).toBe(true);
		// Writes bumped the epoch.
		expect(await readEpoch(db)).toBeGreaterThan(0);
	});

	it("denies commands for unknown roles and non-admins", async () => {
		await expect(
			asUser(
				ADMIN,
				Effect.scoped(
					Effect.gen(function* () {
						const commands = yield* Command.dispatcher(RbacCommands);
						return yield* commands["rbac.setRolePermission"]({
							roleId: 999,
							resource: "patient",
							action: "read",
							effect: "allow",
						});
					}),
				),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				MEMBER,
				Effect.scoped(
					Effect.gen(function* () {
						const commands = yield* Command.dispatcher(RbacCommands);
						return yield* commands["rbac.deleteRole"]({ id: 1 });
					}),
				),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("Permissions + PermissionInvalidator + GroupMembership are provided", async () => {
		const out = await runtime.runPromise(
			Effect.gen(function* () {
				const permissions = yield* Permissions;
				const invalidator = yield* PermissionInvalidator;
				const membership = yield* GroupMembership;
				const groupIds = yield* membership.groupIdsFor("u1");
				const grants = yield* permissions.permissionsFor("u1");
				return { groupIds, grants, invalidate: invalidator.invalidate };
			}),
		);
		expect(out.groupIds).toEqual(["7"]);
		// auditor role assigned? Not yet — empty grants is fine; the
		// point is the services resolve.
		expect(out.grants.size).toBe(0);
		await runtime.runPromise(out.invalidate());
	});
});

describe("plugins", () => {
	it("declares tables, services and panel as single-concern plugins", () => {
		expect(rbacTablesPlugin.id).toBe("rbac.tables");
		expect(rbacTablesPlugin.tables).toBeDefined();
		expect(Object.keys(rbacTablesPlugin.tables ?? {})).toEqual([
			"roles",
			"rolePermissions",
			"subjectRoles",
			"permissionEpoch",
		]);
		expect(rbacServicesPlugin.id).toBe("rbac.services");
		expect(rbacServicesPlugin.requiredDeps).toEqual(["platform.admin"]);
		expect(rbacServicesPlugin.services).toBeDefined();
		expect(rbacPanelPlugin.id).toBe("rbac.panel");
		expect(rbacPanelPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(rbacPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/roles", label: "Roles", icon: ShieldCheckIcon, group: "Access" },
		]);
		expect(rbacPanelPlugin.panel?.pages?.[0]).toMatchObject({
			id: "rbac.admin",
			path: "/platform/roles",
		});
		expect(plugins).toEqual([rbacTablesPlugin, rbacServicesPlugin, rbacPanelPlugin]);
	});
});

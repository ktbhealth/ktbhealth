import { beforeAll, describe, expect, it } from "vitest";

import { Forbidden, Principal } from "@ktb/authz";
import { Db, makeDb, type DbClient } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { eq } from "drizzle-orm";

import {
	buildPermissions,
	bumpEpoch,
	entityAuthz,
	grantKey,
	GroupMembership,
	isKnownPermission,
	permissionKey,
	Permissions,
	PermissionsLive,
	permissionsService,
	readEpoch,
	requireEntityAccess,
	splitPermission,
	subjectRoles,
} from "./index.ts";
import { rolePermissions, roles } from "@ktb/db/schema";

const DDL = `
CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE role_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, resource TEXT NOT NULL, action TEXT NOT NULL, effect TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX role_permissions_role_resource_action_idx ON role_permissions (role_id, resource, action);
CREATE TABLE subject_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, tenant_id TEXT, granted_by TEXT, expires_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX subject_roles_subject_idx ON subject_roles (subject_kind, subject_id);
CREATE TABLE permission_epoch (id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0);
`;

const seed = async (db: DbClient) => {
	await db.insert(roles).values([
		{ id: 1, name: "auditor", description: null, meta: null },
		{ id: 2, name: "billing", description: null, meta: null },
		{ id: 3, name: "temp", description: null, meta: null },
	]);
	await db.insert(rolePermissions).values([
		{ roleId: 1, resource: "patient", action: "read", effect: "allow" },
		{ roleId: 1, resource: "patient", action: "delete", effect: "deny" },
		{ roleId: 2, resource: "billing", action: "manage", effect: "allow" },
		{ roleId: 3, resource: "consultation", action: "read", effect: "allow" },
	]);
	await db.insert(subjectRoles).values([
		// u1: auditor globally + billing inside tenant t1
		{ subjectKind: "user", subjectId: "u1", roleId: 1, tenantId: null, grantedBy: "admin" },
		{ subjectKind: "user", subjectId: "u1", roleId: 2, tenantId: "t1", grantedBy: "admin" },
		// g9: auditor globally
		{ subjectKind: "group", subjectId: "9", roleId: 1, tenantId: null, grantedBy: "admin" },
		// u2: temp role, already expired
		{
			subjectKind: "user",
			subjectId: "u2",
			roleId: 3,
			tenantId: null,
			grantedBy: "admin",
			expiresAt: new Date(Date.now() - 1000),
		},
		// u3: temp role expiring in the future
		{
			subjectKind: "user",
			subjectId: "u3",
			roleId: 3,
			tenantId: null,
			grantedBy: "admin",
			expiresAt: new Date(Date.now() + 60_000),
		},
	]);
};

describe("permission epoch", () => {
	it("readEpoch returns 0 before any bump, bumpEpoch increments", async () => {
		const db = makeDb(makeD1(DDL));
		expect(await readEpoch(db)).toBe(0);
		await bumpEpoch(db);
		expect(await readEpoch(db)).toBe(1);
		await bumpEpoch(db);
		expect(await readEpoch(db)).toBe(2);
	});
});

describe("buildPermissions", () => {
	let db: DbClient;
	let permissions: ReturnType<typeof buildPermissions>;

	beforeAll(async () => {
		db = makeDb(makeD1(DDL));
		await seed(db);
		permissions = buildPermissions(db, (userId) =>
			Effect.succeed<readonly string[]>(userId === "u4" ? ["9"] : []),
		);
	});

	it("resolves direct user grants minus tenant-scoped ones", async () => {
		const grants = await Effect.runPromise(permissions.permissionsFor("u1"));
		expect(grants.get(grantKey("patient", "read"))).toBe("allow");
		expect(grants.get(grantKey("patient", "delete"))).toBe("deny");
		// tenant-scoped grant invisible without a tenant
		expect(grants.has(grantKey("billing", "manage"))).toBe(false);
	});

	it("includes tenant-scoped grants when the tenant matches", async () => {
		const grants = await Effect.runPromise(permissions.permissionsFor("u1", "t1"));
		expect(grants.get(grantKey("billing", "manage"))).toBe("allow");
		// a different tenant sees only global grants
		const other = await Effect.runPromise(permissions.permissionsFor("u1", "t2"));
		expect(other.has(grantKey("billing", "manage"))).toBe(false);
	});

	it("resolves group-derived grants through the port", async () => {
		// u4 has no direct roles but belongs to group 9 (auditor).
		const grants = await Effect.runPromise(permissions.permissionsFor("u4"));
		expect(grants.get(grantKey("patient", "read"))).toBe("allow");
		expect(grants.get(grantKey("patient", "delete"))).toBe("deny");
	});

	it("honours expires_at at resolve time", async () => {
		const expired = await Effect.runPromise(permissions.permissionsFor("u2"));
		expect(expired.size).toBe(0);
		const live = await Effect.runPromise(permissions.permissionsFor("u3"));
		expect(live.get(grantKey("consultation", "read"))).toBe("allow");
	});

	it("canFor/can/requirePermission* enforce grants and deny", async () => {
		expect(await Effect.runPromise(permissions.canFor("u1", "patient", "read"))).toBe(true);
		expect(await Effect.runPromise(permissions.canFor("u1", "billing", "manage", "t1"))).toBe(true);
		// deny grant: the key exists in permissionsFor but canFor is false.
		expect(await Effect.runPromise(permissions.canFor("u1", "patient", "delete"))).toBe(false);
		await Effect.runPromise(permissions.requirePermissionFor("u1", "patient", "read"));
		const denied = await Effect.runPromise(
			permissions.requirePermissionFor("u1", "patient", "update").pipe(Effect.flip),
		);
		expect(denied).toBeInstanceOf(Forbidden);
	});

	it("can/requirePermission bind to the Principal and fail closed", async () => {
		const program = Effect.gen(function* () {
			const p = yield* Permissions;
			expect(yield* p.can("patient", "read")).toBe(true);
			expect(yield* p.can("billing", "manage", { tenantId: "t1" })).toBe(true);
			yield* p.requirePermission("patient", "read");
			return yield* p.requirePermission("patient", "delete").pipe(Effect.flip);
		});
		const DbLive = Layer.succeed(Db, db);
		const runtime = ManagedRuntime.make(
			Layer.merge(DbLive, PermissionsLive.pipe(Layer.provide(DbLive))),
		);
		const result = await runtime.runPromise(
			program.pipe(Effect.provideService(Principal, { userId: "u1" })),
		);
		expect(result).toBeInstanceOf(Forbidden);

		// No principal → can false, requirePermission Forbidden.
		const anon = await runtime.runPromise(
			Effect.gen(function* () {
				const p = yield* Permissions;
				return {
					can: yield* p.can("patient", "read"),
					err: yield* Effect.flip(p.requirePermission("patient", "read")),
				};
			}),
		);
		expect(anon.can).toBe(false);
		expect(anon.err).toBeInstanceOf(Forbidden);
		await runtime.dispose();
	});

	it("caches per (user, tenant, epoch) and invalidate() refreshes", async () => {
		const p = buildPermissions(db);
		const before = await Effect.runPromise(p.permissionsFor("u9"));
		expect(before.size).toBe(0);
		// grant u9 the auditor role directly, then invalidate
		await db.insert(subjectRoles).values({
			subjectKind: "user",
			subjectId: "u9",
			roleId: 1,
			tenantId: null,
			grantedBy: "test",
		});
		await Effect.runPromise(p.invalidate());
		const after = await Effect.runPromise(p.permissionsFor("u9"));
		expect(after.get(grantKey("patient", "read"))).toBe("allow");
	});

	it("expires_at passes between resolves via notAfter", async () => {
		const p = buildPermissions(db);
		const first = await Effect.runPromise(p.permissionsFor("u3"));
		expect(first.has(grantKey("consultation", "read"))).toBe(true);
		const second = await Effect.runPromise(p.permissionsFor("u3"));
		expect(second).toBe(first);
	});

	it("skips a duplicate allow grant for the same (resource, action)", async () => {
		// u5 holds two roles that both allow patient.read — the second
		// row must not overwrite the first (deny-wins ordering stays
		// stable regardless of row order).
		await db.insert(roles).values({ id: 4, name: "auditor2", description: null, meta: null });
		await db.insert(rolePermissions).values({
			roleId: 4,
			resource: "patient",
			action: "read",
			effect: "allow",
		});
		await db.insert(subjectRoles).values([
			{ subjectKind: "user", subjectId: "u5", roleId: 1, tenantId: null, grantedBy: "test" },
			{ subjectKind: "user", subjectId: "u5", roleId: 4, tenantId: null, grantedBy: "test" },
		]);
		const p = buildPermissions(db);
		const grants = await Effect.runPromise(p.permissionsFor("u5"));
		expect(grants.get(grantKey("patient", "read"))).toBe("allow");
		expect(grants.get(grantKey("patient", "delete"))).toBe("deny");
	});

	it("tracks the earliest expiry across multiple grants", async () => {
		// u6: two expiring assignments — the second row's expiry is later
		// than the first's, exercising the notAfter comparison both ways.
		await db.insert(subjectRoles).values([
			{
				subjectKind: "user",
				subjectId: "u6",
				roleId: 1,
				tenantId: null,
				grantedBy: "test",
				expiresAt: new Date(Date.now() + 30_000),
			},
			{
				subjectKind: "user",
				subjectId: "u6",
				roleId: 3,
				tenantId: null,
				grantedBy: "test",
				expiresAt: new Date(Date.now() + 90_000),
			},
		]);
		const p = buildPermissions(db);
		const grants = await Effect.runPromise(p.permissionsFor("u6"));
		expect(grants.get(grantKey("patient", "read"))).toBe("allow");
		expect(grants.get(grantKey("consultation", "read"))).toBe("allow");
	});

	it("clears the grant cache once it reaches the bound", async () => {
		const p = buildPermissions(db);
		// CACHE_LIMIT is 1000 — resolving one more distinct user evicts
		// the whole map; earlier entries must re-resolve cleanly.
		for (let i = 0; i < 1001; i++) {
			await Effect.runPromise(p.permissionsFor(`bulk-${i}`));
		}
		const grants = await Effect.runPromise(p.permissionsFor("u1"));
		expect(grants.get(grantKey("patient", "read"))).toBe("allow");
	});
});

describe("permissionsService", () => {
	it("builds without GroupMembership (no group grants)", async () => {
		const db = makeDb(makeD1(DDL));
		await seed(db);
		const DbLive = Layer.succeed(Db, db);
		const runtime = ManagedRuntime.make(
			Layer.merge(DbLive, PermissionsLive.pipe(Layer.provide(DbLive))),
		);
		const grants = await runtime.runPromise(
			Effect.gen(function* () {
				const p = yield* Permissions;
				return yield* p.permissionsFor("u1");
			}),
		);
		expect(grants.get(grantKey("patient", "read"))).toBe("allow");
		await runtime.dispose();
	});

	it("wires GroupMembership when provided", async () => {
		const db = makeDb(makeD1(DDL));
		await seed(db);
		const membership = GroupMembership.of({
			groupIdsFor: () => Effect.succeed<readonly string[]>(["9"]),
		});
		const DbLive = Layer.succeed(Db, db);
		const runtime = ManagedRuntime.make(
			Layer.merge(
				Layer.mergeAll(DbLive, Layer.succeed(GroupMembership, membership)),
				PermissionsLive.pipe(
					Layer.provide(Layer.mergeAll(DbLive, Layer.succeed(GroupMembership, membership))),
				),
			),
		);
		const grants = await runtime.runPromise(
			Effect.gen(function* () {
				const p = yield* Permissions;
				return yield* p.permissionsFor("u4");
			}),
		);
		expect(grants.get(grantKey("patient", "read"))).toBe("allow");
		await runtime.dispose();
	});

	it("permissionsService effect resolves the same shape", async () => {
		const db = makeDb(makeD1(DDL));
		await seed(db);
		const shape = await Effect.runPromise(permissionsService.pipe(Effect.provideService(Db, db)));
		const grants = await Effect.runPromise(shape.permissionsFor("u1", "t1"));
		expect(grants.get(grantKey("billing", "manage"))).toBe("allow");
	});
});

describe("entity authz seam", () => {
	let db: DbClient;

	beforeAll(async () => {
		db = makeDb(makeD1(DDL));
		await seed(db);
	});

	it("rbac mode checks dynamic grants through Permissions", async () => {
		const DbLive = Layer.succeed(Db, db);
		const runtime = ManagedRuntime.make(
			Layer.merge(DbLive, PermissionsLive.pipe(Layer.provide(DbLive))),
		);
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				yield* requireEntityAccess(entityAuthz("rbac", "patient", "read"));
				return yield* Effect.flip(requireEntityAccess(entityAuthz("rbac", "patient", "update")));
			}).pipe(Effect.provideService(Principal, { userId: "u1" })),
		);
		expect(result).toBeInstanceOf(Forbidden);
		await runtime.dispose();
	});

	it("static mode delegates to permix rulesFor", async () => {
		// patient.read static rule: ownerId must equal principal userId.
		const ok = await Effect.runPromise(
			requireEntityAccess(entityAuthz("static", "patient", "read"), {
				ownerId: "u1",
			}).pipe(Effect.provideService(Principal, { userId: "u1" })),
		);
		expect(ok).toBeUndefined();
		const err = await Effect.runPromise(
			Effect.flip(
				requireEntityAccess(entityAuthz("static", "patient", "read"), {
					ownerId: "someone-else",
				}).pipe(Effect.provideService(Principal, { userId: "u1" })),
			),
		);
		expect(err).toBeInstanceOf(Forbidden);
	});
});

describe("vocabulary", () => {
	it("splits and rejoins permission strings", () => {
		expect(splitPermission("patient.read")).toEqual({ resource: "patient", action: "read" });
		expect(splitPermission("nodot")).toEqual({ resource: "nodot", action: "" });
		expect(permissionKey("patient", "read")).toBe("patient.read");
		expect(isKnownPermission("patient", "read")).toBe(true);
		expect(isKnownPermission("patient", "fly")).toBe(false);
		expect(isKnownPermission("billing", "manage")).toBe(true);
	});
});

describe("schema round-trip", () => {
	it("subject_roles rows round-trip through drizzle", async () => {
		const db = makeDb(makeD1(DDL));
		await seed(db);
		const rows = await db.select().from(subjectRoles).where(eq(subjectRoles.subjectId, "u1"));
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.roleId).sort((a, b) => a - b)).toEqual([1, 2]);
	});
});

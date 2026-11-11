import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Query } from "@effect-server-utils/cqrs";
import { adminAudit, AUDIT_TEST_DDL, AuditLive } from "@ktb/audit";
import { Db, makeDb, type DbClient } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Forbidden, Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { eq } from "drizzle-orm";
import { BoxesIcon } from "lucide-react";

import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { PermissionInvalidator } from "@ktb/rbac";

import { GroupsQueries } from "./api.ts";
import { groups as groupsTable } from "./schema.ts";
import {
	addMember,
	createGroup,
	deleteGroup,
	findMembership,
	getGroup,
	Groups,
	GroupsLive,
	GroupsQueriesLive,
	groupsPanelPlugin,
	groupsServicesPlugin,
	groupsTablesPlugin,
	listGroups,
	listMembers,
	plugins,
	removeMember,
	updateMemberRole,
} from "./index.ts";

const DDL = `
CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO groups (name, slug, kind, meta, created_at, updated_at) VALUES
  ('Clinic A', 'clinic-a', 'clinic', '{"city":"sp"}', 1000, 1000),
  ('Org B', 'org-b', 'org', NULL, 2000, 2000);
CREATE TABLE group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, member_kind TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX group_members_group_member_idx ON group_members (group_id, member_kind, member_id);
INSERT INTO group_members (group_id, member_kind, member_id, role, created_at) VALUES
  (1, 'user', 'u1', 'admin', 1000),
  (1, 'user', 'u2', NULL, 1000),
  (2, 'patient', 'p1', 'member', 1000);
${AUDIT_TEST_DDL}
`;

describe("groups repo", () => {
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("listGroups returns groups newest-first with member counts", async () => {
		const rows = await listGroups(db);
		expect(rows.map((r) => r.slug)).toEqual(["org-b", "clinic-a"]);
		const org = rows.find((r) => r.slug === "org-b")!;
		expect(org.memberCount).toBe(1);
		expect(org.meta).toBeNull();
		const clinic = rows.find((r) => r.slug === "clinic-a")!;
		expect(clinic.memberCount).toBe(2);
		expect(clinic.meta).toBe('{"city":"sp"}');
	});

	it("createGroup inserts a row with defaults", async () => {
		const created = await createGroup(db, { name: "Cohort", slug: "cohort-1", kind: "cohort" });
		expect(created).not.toBeNull();
		expect(created!.name).toBe("Cohort");
		expect(created!.meta).toBeNull();
		expect((await getGroup(db, created!.id))?.slug).toBe("cohort-1");
		expect(await getGroup(db, 999)).toBeNull();
	});

	it("addMember/findMembership/listMembers/removeMember round-trip", async () => {
		const member = await addMember(db, {
			groupId: 2,
			memberKind: "user",
			memberId: "u9",
			role: "lead",
		});
		expect(member).not.toBeNull();
		expect(member!.role).toBe("lead");

		const found = await findMembership(db, 2, "user", "u9");
		expect(found?.id).toBe(member!.id);
		expect(await findMembership(db, 2, "user", "nope")).toBeNull();

		const members = await listMembers(db, 2);
		expect(members.map((m) => m.memberId).sort()).toEqual(["p1", "u9"]);

		const removed = await removeMember(db, {
			groupId: 2,
			memberKind: "user",
			memberId: "u9",
		});
		expect(removed?.id).toBe(member!.id);
		expect(await findMembership(db, 2, "user", "u9")).toBeNull();
		expect(await removeMember(db, { groupId: 2, memberKind: "user", memberId: "u9" })).toBeNull();
	});

	it("updateMemberRole rewrites the role and reports misses", async () => {
		const updated = await updateMemberRole(db, {
			groupId: 1,
			memberKind: "user",
			memberId: "u2",
			role: "owner",
		});
		expect(updated?.role).toBe("owner");
		expect((await findMembership(db, 1, "user", "u2"))?.role).toBe("owner");
		// Clearing the role stores null.
		const cleared = await updateMemberRole(db, {
			groupId: 1,
			memberKind: "user",
			memberId: "u2",
			role: null,
		});
		expect(cleared?.role).toBeNull();
		expect(
			await updateMemberRole(db, {
				groupId: 1,
				memberKind: "user",
				memberId: "ghost",
				role: "admin",
			}),
		).toBeNull();
	});
	it("createGroup stores the optional meta payload", async () => {
		const created = await createGroup(db, {
			name: "With meta",
			slug: "with-meta",
			kind: "clinic",
			meta: '{"city":"rj"}',
		});
		expect(created!.meta).toBe('{"city":"rj"}');
	});

	it("listGroups reports zero members for a group nobody joined", async () => {
		const empty = await createGroup(db, { name: "Empty", slug: "empty-group", kind: "cohort" });
		const rows = await listGroups(db);
		expect(rows.find((r) => r.id === empty!.id)?.memberCount).toBe(0);
	});

	it("addMember stores a null role when none is given", async () => {
		const member = await addMember(db, { groupId: 2, memberKind: "user", memberId: "norole" });
		expect(member!.role).toBeNull();
	});

	it("updating a group refreshes updated_at through the $onUpdate hook", async () => {
		await db.update(groupsTable).set({ name: "Clinic A2" }).where(eq(groupsTable.id, 1));
		const row = await getGroup(db, 1);
		expect(row!.name).toBe("Clinic A2");
		expect(row!.updatedAt.getTime()).toBeGreaterThan(1000);
	});

	it("deleteGroup removes the row and reports misses", async () => {
		// Membership cascade is schema-level (schema.test.ts asserts the
		// onDelete: "cascade" reference); the in-memory driver does not
		// enforce PRAGMA foreign_keys.
		expect(await deleteGroup(db, 2)).toBe(true);
		expect(await getGroup(db, 2)).toBeNull();
		expect(await deleteGroup(db, 999)).toBe(false);
	});
});

describe("groups repo — empty driver results", () => {
	// A driver that returns no rows from INSERT ... RETURNING / COUNT: the
	// repo helpers must degrade to null / 0 instead of throwing.
	const emptyInsert = {
		insert: () => ({ values: () => ({ returning: async () => [] }) }),
	} as unknown as DbClient;

	it("createGroup and addMember return null when RETURNING yields no row", async () => {
		expect(await createGroup(emptyInsert, { name: "X", slug: "x", kind: "k" })).toBeNull();
		expect(
			await addMember(emptyInsert, { groupId: 1, memberKind: "user", memberId: "u" }),
		).toBeNull();
	});

	it("updateMemberRole falls back to the pre-update row when RETURNING yields nothing", async () => {
		const memberRow = { id: 7, role: "admin" };
		const fakeDb = {
			select: () => ({ from: () => ({ where: async () => [memberRow] }) }),
			update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
		} as unknown as DbClient;
		const result = await updateMemberRole(fakeDb, {
			groupId: 1,
			memberKind: "user",
			memberId: "u1",
			role: "owner",
		});
		expect(result).toBe(memberRow);
	});
});

describe("GroupsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Groups, never>;
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
		const deps = Layer.merge(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		// Provide the real audit service so admin mutations write
		// admin_audit rows (T-037); the "PermissionInvalidator" describe
		// below intentionally omits it to cover the optional-absent path.
		const allDeps = Layer.merge(deps, AuditLive.pipe(Layer.provide(deps)));
		runtime = ManagedRuntime.make(GroupsLive.pipe(Layer.provideMerge(allDeps)));
	});

	afterAll(() => runtime.dispose());

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Groups>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const call = <A, E>(f: (p: Groups["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Groups, f);

	it("list returns all groups with memberCount for admins", async () => {
		const rows = await asUser(
			"u1",
			call((p) => p.list()),
			"admin@x.com",
		);
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.slug === "clinic-a")?.memberCount).toBe(2);
		expect(rows.find((r) => r.slug === "org-b")?.memberCount).toBe(1);
	});

	it("get returns the group with memberCount for admins", async () => {
		const row = await asUser(
			"u1",
			call((p) => p.get(1)),
			"admin@x.com",
		);
		expect(row?.slug).toBe("clinic-a");
		expect(row?.memberCount).toBe(2);
		const missing = await asUser(
			"u1",
			call((p) => p.get(999)),
			"admin@x.com",
		);
		expect(missing).toBeNull();
	});

	it("admin ops fail Forbidden for non-admin email and null principal", async () => {
		await expect(
			asUser(
				"u2",
				call((p) => p.list()),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
		await expect(
			asUser(
				"u2",
				call((p) => p.create({ name: "X", slug: "x", kind: "custom" })),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
		await expect(
			asUser(
				null,
				call((p) => p.members(1)),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("admin addMember/removeMember/members round-trip", async () => {
		const added = await asUser(
			"u1",
			call((p) => p.addMember({ groupId: 1, memberKind: "user", memberId: "u7", role: "mod" })),
			"admin@x.com",
		);
		expect(added?.memberId).toBe("u7");
		const members = await asUser(
			"u1",
			call((p) => p.members(1)),
			"admin@x.com",
		);
		expect(members).toHaveLength(3);
		const removed = await asUser(
			"u1",
			call((p) => p.removeMember({ groupId: 1, memberKind: "user", memberId: "u7" })),
			"admin@x.com",
		);
		expect(removed?.memberId).toBe("u7");
	});

	it("admin updateMemberRole rewrites roles, misses return null and non-admins are Forbidden", async () => {
		const updated = await asUser(
			"u1",
			call((p) =>
				p.updateMemberRole({
					groupId: 1,
					memberKind: "user",
					memberId: "u2",
					role: "member",
				}),
			),
			"admin@x.com",
		);
		expect(updated?.role).toBe("member");
		const missing = await asUser(
			"u1",
			call((p) =>
				p.updateMemberRole({
					groupId: 1,
					memberKind: "user",
					memberId: "ghost",
					role: "admin",
				}),
			),
			"admin@x.com",
		);
		expect(missing).toBeNull();
		await expect(
			asUser(
				"u2",
				call((p) =>
					p.updateMemberRole({
						groupId: 1,
						memberKind: "user",
						memberId: "u1",
						role: "member",
					}),
				),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
	});

	it("requireMember passes when the bound user is a member", async () => {
		const member = await asUser(
			"u1",
			call((p) => p.requireMember(1, "user", "u1")),
		);
		expect(member.memberId).toBe("u1");
		const patient = await asUser(
			"u2",
			call((p) => p.requireMember(2, "patient", "p1")),
		);
		expect(patient.memberId).toBe("p1");
	});

	it("requireMember fails Forbidden for non-members, principal mismatch and null principal", async () => {
		await expect(
			asUser(
				"u3",
				call((p) => p.requireMember(1, "user", "u1")),
				"u3@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "groups.member" });
		// Bound user u2 IS a member of group 1 — but the check names u1.
		await expect(
			asUser(
				"u2",
				call((p) => p.requireMember(1, "user", "u1")),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "groups.member" });
		await expect(
			asUser(
				null,
				call((p) => p.requireMember(1, "user", "u1")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		// No membership row at all.
		await expect(
			asUser(
				"u1",
				call((p) => p.requireMember(1, "user", "ghost")),
				"admin@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "groups.member" });
	});

	it("create inserts a group for admins and is Forbidden otherwise", async () => {
		const created = await asUser(
			"u1",
			call((p) => p.create({ name: "New", slug: "new-group", kind: "custom", meta: "{}" })),
			"admin@x.com",
		);
		expect(created).toMatchObject({ slug: "new-group", kind: "custom", meta: "{}" });
		await expect(
			asUser(
				"u2",
				call((p) => p.create({ name: "Nope", slug: "nope", kind: "custom" })),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
	});

	it("admin mutations write audit rows", async () => {
		const group = await asUser(
			"u1",
			call((p) => p.create({ name: "Audited", slug: "audited", kind: "custom" })),
			"admin@x.com",
		);
		const gid = group!.id;
		await asUser(
			"u1",
			call((p) => p.addMember({ groupId: gid, memberKind: "user", memberId: "u8", role: "mod" })),
			"admin@x.com",
		);
		await asUser(
			"u1",
			call((p) =>
				p.updateMemberRole({ groupId: gid, memberKind: "user", memberId: "u8", role: "lead" }),
			),
			"admin@x.com",
		);
		await asUser(
			"u1",
			call((p) => p.removeMember({ groupId: gid, memberKind: "user", memberId: "u8" })),
			"admin@x.com",
		);
		await asUser(
			"u1",
			call((p) => p.delete(gid)),
			"admin@x.com",
		);
		const rows = await db.select().from(adminAudit);
		// Other tests in this describe also mutate groups — scope every
		// assertion to the group this test created.
		const mine = rows.filter((r) => r.targetId === String(gid));
		const byAction = (action: string) => mine.filter((r) => r.action === action);
		expect(byAction("groups.create")).toHaveLength(1);
		expect(byAction("groups.member.add")).toHaveLength(1);
		expect(byAction("groups.member.setRole")).toHaveLength(1);
		expect(byAction("groups.member.remove")).toHaveLength(1);
		expect(byAction("groups.delete")).toHaveLength(1);
		const created = byAction("groups.create")[0]!;
		expect(created).toMatchObject({
			actorUserId: "u1",
			actorEmail: "admin@x.com",
			targetType: "group",
			tenantId: gid,
		});
	});

	it("requireMember fails Forbidden when the bound user has no membership row", async () => {
		// u1 IS the principal, but belongs to group 1 only — group 2 has no row.
		await expect(
			asUser(
				"u1",
				call((p) => p.requireMember(2, "user", "u1")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "groups.member" });
		// Non-user kinds skip the principal check and still need the row.
		await expect(
			asUser(
				"u1",
				call((p) => p.requireMember(2, "patient", "ghost")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "groups.member" });
	});

	it("delete removes a group for admins, reports misses and is Forbidden otherwise", async () => {
		// Runs last: deleting group 2 cascades its patient membership used
		// by the requireMember tests above.
		const deleted = await asUser(
			"u1",
			call((p) => p.delete(2)),
			"admin@x.com",
		);
		expect(deleted).toBe(true);
		expect(
			await asUser(
				"u1",
				call((p) => p.get(2)),
				"admin@x.com",
			),
		).toBeNull();
		const missing = await asUser(
			"u1",
			call((p) => p.delete(999)),
			"admin@x.com",
		);
		expect(missing).toBe(false);
		await expect(
			asUser(
				"u2",
				call((p) => p.delete(1)),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
	});
});

describe("GroupsLive with a driver that returns no rows", () => {
	it("get reports zero members when the COUNT query yields no row", async () => {
		const group = { id: 1, name: "G", slug: "g", kind: "k", meta: null };
		const results: unknown[][] = [[group], []];
		const fakeDb = {
			select: () => ({ from: () => ({ where: async () => results.shift() ?? [] }) }),
		} as unknown as DbClient;
		const deps = Layer.merge(
			Layer.succeed(Db, fakeDb),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		const runtime = ManagedRuntime.make(GroupsLive.pipe(Layer.provide(deps)));
		try {
			const row = await runtime.runPromise(
				Effect.provideService(
					Effect.flatMap(Groups, (p) => p.get(1)),
					Principal,
					{ userId: "u1", email: "admin@x.com" },
				),
			);
			expect(row).toMatchObject({ id: 1, memberCount: 0 });
		} finally {
			await runtime.dispose();
		}
	});
});

describe("GroupsQueriesLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Query.Registered<typeof GroupsQueries>, never>;

	beforeAll(() => {
		const db = makeDb(makeD1(DDL));
		runtime = ManagedRuntime.make(
			GroupsQueriesLive.pipe(Layer.provide(Layer.succeed(Db, db))) as Layer.Layer<
				Query.Registered<typeof GroupsQueries>,
				never,
				never
			>,
		);
	});

	afterAll(() => runtime.dispose());

	const get = (id: number) =>
		runtime.runPromise(
			Effect.gen(function* () {
				const queries = yield* Query.dispatcher(GroupsQueries);
				return yield* queries["groups.get"]({ id });
			}).pipe(Effect.scoped),
		);

	it("groups.get returns the raw group row", async () => {
		expect(await get(1)).toEqual({ id: 1, name: "Clinic A", slug: "clinic-a", kind: "clinic" });
	});

	it("groups.get returns null for an unknown id", async () => {
		expect(await get(999)).toBeNull();
	});
});

describe("plugins", () => {
	it("declares tables, services and panel as single-concern plugins", () => {
		expect(groupsTablesPlugin.id).toBe("groups.tables");
		expect(groupsTablesPlugin.tables).toBeDefined();
		expect(groupsServicesPlugin.id).toBe("groups.services");
		expect(groupsServicesPlugin.requiredDeps).toEqual(["platform.admin"]);
		expect(groupsServicesPlugin.services).toBeDefined();
		expect(groupsPanelPlugin.id).toBe("groups.panel");
		expect(groupsPanelPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(groupsPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/groups", label: "Groups", icon: BoxesIcon, group: "Access" },
		]);
	});

	describe("panel page loader", () => {
		const loader = groupsPanelPlugin.panel!.pages![0]!.loader as () => Effect.Effect<
			unknown,
			never,
			Groups
		>;
		const withGroups = (list: Groups["Service"]["list"]) =>
			Effect.runPromise(
				loader().pipe(Effect.provideService(Groups, { list } as unknown as Groups["Service"])),
			);

		it("returns the group listing for admins", async () => {
			const rows = [{ id: 1, memberCount: 2 }];
			expect(await withGroups(() => Effect.succeed(rows as never))).toEqual(rows);
		});

		it("collapses Forbidden to an empty table", async () => {
			expect(
				await withGroups(() => Effect.fail(new Forbidden({ path: "platform.admin" }))),
			).toEqual([]);
		});
	});

	it("contributes no routes or top-nav", () => {
		for (const p of [groupsTablesPlugin, groupsServicesPlugin, groupsPanelPlugin]) {
			expect("routes" in p).toBe(false);
			expect("landingNav" in p).toBe(false);
		}
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["groups.tables", "groups.services", "groups.panel"]);
	});
});

describe("GroupsLive with PermissionInvalidator", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Groups, never>;
	let invalidations = 0;

	beforeAll(() => {
		const db = makeDb(makeD1(DDL));
		const deps = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
			Layer.succeed(PermissionInvalidator, {
				invalidate: () => Effect.sync(() => invalidations++),
			}),
		);
		runtime = ManagedRuntime.make(GroupsLive.pipe(Layer.provide(deps)));
	});

	afterAll(() => runtime.dispose());

	it("membership writes and group deletes bump the permission epoch", async () => {
		const added = await runtime.runPromise(
			Effect.flatMap(Groups, (p) =>
				p.addMember({ groupId: 1, memberKind: "user", memberId: "u9", role: "mod" }),
			).pipe(
				Effect.provideService(Principal, {
					userId: "u1",
					email: "admin@x.com",
				}),
			),
		);
		expect(added?.memberId).toBe("u9");
		const removed = await runtime.runPromise(
			Effect.flatMap(Groups, (p) =>
				p.removeMember({ groupId: 1, memberKind: "user", memberId: "u9" }),
			).pipe(
				Effect.provideService(Principal, {
					userId: "u1",
					email: "admin@x.com",
				}),
			),
		);
		expect(removed?.memberId).toBe("u9");
		// A role update on an existing membership bumps the epoch too; a
		// miss (null member) does not.
		const updated = await runtime.runPromise(
			Effect.flatMap(Groups, (p) =>
				p.updateMemberRole({ groupId: 1, memberKind: "user", memberId: "u1", role: "owner" }),
			).pipe(
				Effect.provideService(Principal, {
					userId: "u1",
					email: "admin@x.com",
				}),
			),
		);
		expect(updated?.role).toBe("owner");
		const missed = await runtime.runPromise(
			Effect.flatMap(Groups, (p) =>
				p.updateMemberRole({ groupId: 1, memberKind: "user", memberId: "ghost", role: "admin" }),
			).pipe(
				Effect.provideService(Principal, {
					userId: "u1",
					email: "admin@x.com",
				}),
			),
		);
		expect(missed).toBeNull();
		// A successful delete cascades memberships — same epoch bump.
		const deleted = await runtime.runPromise(
			Effect.flatMap(Groups, (p) => p.delete(2)).pipe(
				Effect.provideService(Principal, {
					userId: "u1",
					email: "admin@x.com",
				}),
			),
		);
		expect(deleted).toBe(true);
		expect(invalidations).toBe(4);
	});
});

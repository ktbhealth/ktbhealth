import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { BoxesIcon } from "lucide-react";

import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";

import {
	addMember,
	createGroup,
	findMembership,
	getGroup,
	Groups,
	GroupsLive,
	groupsPanelPlugin,
	groupsServicesPlugin,
	groupsTablesPlugin,
	listGroups,
	listMembers,
	plugins,
	removeMember,
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
});

describe("GroupsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Groups, never>;

	beforeAll(() => {
		const db = makeDb(makeD1(DDL));
		const deps = Layer.merge(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		runtime = ManagedRuntime.make(GroupsLive.pipe(Layer.provide(deps)));
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
});

describe("plugins", () => {
	it("declares tables, services and panel as single-concern plugins", () => {
		expect(groupsTablesPlugin.id).toBe("groups.tables");
		expect(groupsTablesPlugin.tables).toBeDefined();
		expect(groupsServicesPlugin.id).toBe("groups.services");
		expect(groupsServicesPlugin.requiredDeps).toEqual(["platform.admin"]);
		expect(groupsServicesPlugin.services).toBe(GroupsLive);
		expect(groupsPanelPlugin.id).toBe("groups.panel");
		expect(groupsPanelPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(groupsPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/groups", label: "Groups", icon: BoxesIcon, group: "Access" },
		]);
	});

	it("contributes no routes or top-nav", () => {
		for (const p of [groupsTablesPlugin, groupsServicesPlugin, groupsPanelPlugin]) {
			expect("routes" in p).toBe(false);
			expect("nav" in p).toBe(false);
		}
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["groups.tables", "groups.services", "groups.panel"]);
	});
});

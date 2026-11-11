import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Forbidden, Principal } from "@ktb/authz";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { groupsServicesPlugin } from "@ktb/groups";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { Building2Icon } from "lucide-react";

import { plugins, Tenants, tenantPanelPlugin, tenantServicesPlugin, TenantsLive } from "./index.ts";

const DDL = `
CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO groups (name, slug, kind, meta, created_at, updated_at) VALUES
  ('Clinic A', 'clinic-a', 'clinic', NULL, 1000, 1000),
  ('Org B', 'org-b', 'org', NULL, 2000, 2000);
CREATE TABLE group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, member_kind TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX group_members_group_member_idx ON group_members (group_id, member_kind, member_id);
INSERT INTO group_members (group_id, member_kind, member_id, role, created_at) VALUES
  (1, 'user', 'u1', 'admin', 1000),
  (1, 'user', 'u2', NULL, 1000),
  (1, 'patient', 'p1', 'member', 1000),
  (2, 'user', 'u3', 'owner', 1000);
`;

describe("TenantsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Tenants, never>;

	beforeAll(() => {
		const db = makeDb(makeD1(DDL));
		const env = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		// Same composition the host uses: the groups services layer feeds
		// the Tenants layer through provideMerge, env provides the infra.
		const services = (tenantServicesPlugin.services as Layer.Layer<unknown, unknown, unknown>).pipe(
			Layer.provideMerge(groupsServicesPlugin.services as Layer.Layer<unknown, unknown, unknown>),
			Layer.provide(env),
		) as Layer.Layer<Tenants, never, never>;
		runtime = ManagedRuntime.make(services);
	});

	afterAll(() => runtime.dispose());

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Tenants>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const call = <A, E>(f: (p: Tenants["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Tenants, f);

	it("list returns groups as tenant rows with member counts for admins", async () => {
		const rows = await asUser(
			"u1",
			call((p) => p.list()),
			"admin@x.com",
		);
		expect(rows.map((r) => r.slug)).toEqual(["org-b", "clinic-a"]);
		expect(rows.find((r) => r.slug === "clinic-a")?.memberCount).toBe(3);
		expect(rows.find((r) => r.slug === "org-b")?.memberCount).toBe(1);
	});

	it("members returns only user-kind memberships", async () => {
		const members = await asUser(
			"u1",
			call((p) => p.members(1)),
			"admin@x.com",
		);
		// The patient membership on group 1 is a group member, not a
		// tenant member — the tenant view filters it out.
		expect(members.map((m) => m.memberId).sort()).toEqual(["u1", "u2"]);
		expect(members.every((m) => m.memberKind === "user")).toBe(true);
	});

	it("addMember/removeMember/setRole round-trip as user memberships", async () => {
		const added = await asUser(
			"u1",
			call((p) => p.addMember({ tenantId: 2, memberId: "u9", role: "admin" })),
			"admin@x.com",
		);
		expect(added).toMatchObject({ memberKind: "user", memberId: "u9", role: "admin" });

		const updated = await asUser(
			"u1",
			call((p) => p.setRole({ tenantId: 2, memberId: "u9", role: "member" })),
			"admin@x.com",
		);
		expect(updated?.role).toBe("member");

		const cleared = await asUser(
			"u1",
			call((p) => p.setRole({ tenantId: 2, memberId: "u9", role: null })),
			"admin@x.com",
		);
		expect(cleared?.role).toBeNull();

		const removed = await asUser(
			"u1",
			call((p) => p.removeMember({ tenantId: 2, memberId: "u9" })),
			"admin@x.com",
		);
		expect(removed?.memberId).toBe("u9");
		// Unknown membership → null.
		expect(
			await asUser(
				"u1",
				call((p) => p.removeMember({ tenantId: 2, memberId: "ghost" })),
				"admin@x.com",
			),
		).toBeNull();
		expect(
			await asUser(
				"u1",
				call((p) => p.setRole({ tenantId: 2, memberId: "ghost", role: "admin" })),
				"admin@x.com",
			),
		).toBeNull();
	});

	it("admin ops fail Forbidden for non-admin principals and null principal", async () => {
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
				call((p) => p.addMember({ tenantId: 1, memberId: "u5" })),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				null,
				call((p) => p.members(1)),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				null,
				call((p) => p.setRole({ tenantId: 1, memberId: "u1", role: "member" })),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});
});

describe("plugins", () => {
	it("declares services and panel as single-concern plugins", () => {
		expect(tenantServicesPlugin.id).toBe("tenant.services");
		expect(tenantServicesPlugin.requiredDeps).toEqual(["groups.services"]);
		expect(tenantServicesPlugin.services).toBeDefined();
		expect(TenantsLive).toBeDefined();
		expect(tenantPanelPlugin.id).toBe("tenant.panel");
		expect(tenantPanelPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(tenantPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/tenants", label: "Tenants", icon: Building2Icon, group: "Access" },
		]);
	});

	describe("panel page loader", () => {
		const loader = tenantPanelPlugin.panel!.pages![0]!.loader as () => Effect.Effect<
			unknown,
			never,
			Tenants
		>;
		const withTenants = (list: Tenants["Service"]["list"]) =>
			Effect.runPromise(
				loader().pipe(Effect.provideService(Tenants, { list } as unknown as Tenants["Service"])),
			);

		it("returns the tenant listing for admins", async () => {
			const rows = [{ id: 1, memberCount: 2 }];
			expect(await withTenants(() => Effect.succeed(rows as never))).toEqual(rows);
		});

		it("collapses Forbidden to an empty table", async () => {
			expect(
				await withTenants(() => Effect.fail(new Forbidden({ path: "platform.admin" }))),
			).toEqual([]);
		});
	});

	it("contributes no routes, tables or top-nav", () => {
		for (const p of [tenantServicesPlugin, tenantPanelPlugin]) {
			expect("routes" in p).toBe(false);
			expect("tables" in p).toBe(false);
			expect("landingNav" in p).toBe(false);
		}
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["tenant.services", "tenant.panel"]);
	});
});

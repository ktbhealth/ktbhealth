import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import type { TenantSelector } from "@ktb/tenant";

import { makeTenantDirectory } from "./tenant-directory.ts";

const DDL = `
CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, meta TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO groups (name, slug, kind, meta, created_at, updated_at) VALUES
  ('Clinic A', 'clinic-a', 'clinic', '{"city":"sp"}', 1000, 1000),
  ('Org B', 'org-b', 'org', NULL, 2000, 2000),
  ('Cohort C', 'cohort-c', 'cohort', 'not-json{{', 3000, 3000),
  ('Clinic D', 'clinic-d', 'clinic', NULL, 4000, 4000);
CREATE TABLE group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, member_kind TEXT NOT NULL, member_id TEXT NOT NULL, role TEXT, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX group_members_group_member_idx ON group_members (group_id, member_kind, member_id);
INSERT INTO group_members (group_id, member_kind, member_id, role, created_at) VALUES
  (1, 'user', 'u1', 'admin', 1000),
  (2, 'user', 'u1', NULL, 1000),
  (3, 'user', 'u1', 'lead', 1000),
  (4, 'user', 'u1', 'OWNER', 1000),
  (4, 'patient', 'u1', 'admin', 1000),
  (2, 'user', 'u2', 'member', 1000),
  (1, 'user', 'u3', 'member', 1000);
`;

const directory = makeTenantDirectory(makeDb(makeD1(DDL)));

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
const find = (userId: string, selector: TenantSelector) =>
	run(directory.findBySelector(userId, selector));

describe("tenant directory membershipsFor", () => {
	it("maps groups+members to TenantMembership with normalized roles", async () => {
		const memberships = await run(directory.membershipsFor("u1"));
		expect(memberships).toHaveLength(4);
		// Ordered by group id; the 'patient' member row for u1 is excluded.
		expect(memberships.map((m) => m.tenant.slug)).toEqual([
			"clinic-a",
			"org-b",
			"cohort-c",
			"clinic-d",
		]);

		const [clinicA, orgB, cohortC, clinicD] = memberships;
		expect(clinicA!.tenant).toEqual({
			id: 1,
			kind: "clinic",
			slug: "clinic-a",
			meta: { city: "sp" },
		});
		expect(clinicA!.role).toBe("admin");

		// NULL role → member; NULL meta → undefined.
		expect(orgB!.role).toBe("member");
		expect(orgB!.tenant.meta).toBeUndefined();

		// Unknown free-form role → member; malformed JSON meta → undefined.
		expect(cohortC!.role).toBe("member");
		expect(cohortC!.tenant.meta).toBeUndefined();

		// Role matching is case-insensitive.
		expect(clinicD!.role).toBe("owner");
	});

	it("returns a single membership for other members", async () => {
		const memberships = await run(directory.membershipsFor("u2"));
		expect(memberships).toHaveLength(1);
		expect(memberships[0]).toEqual({
			tenant: { id: 2, kind: "org", slug: "org-b", meta: undefined },
			role: "member",
		});
	});

	it("returns an empty list for users with no memberships", async () => {
		await expect(run(directory.membershipsFor("nobody"))).resolves.toEqual([]);
	});

	it("fails when the underlying query fails", async () => {
		// No tables in this database — the select rejects and the
		// directory surfaces it as a typed Effect failure.
		const broken = makeTenantDirectory(makeDb(makeD1()));
		const exit = await Effect.runPromiseExit(broken.membershipsFor("u1"));
		expect(exit._tag).toBe("Failure");
	});
});

describe("tenant directory findBySelector", () => {
	it("resolves by slug", async () => {
		await expect(find("u1", { slug: "clinic-a" })).resolves.toEqual({
			id: 1,
			kind: "clinic",
			slug: "clinic-a",
			meta: { city: "sp" },
			role: "admin",
		});
	});

	it("resolves by numeric and string ids", async () => {
		const byNumber = await find("u1", { id: 2 });
		expect(byNumber?.slug).toBe("org-b");
		expect(byNumber?.role).toBe("member");
		const byString = await find("u1", { id: "2" });
		expect(byString?.slug).toBe("org-b");
	});

	it("resolves by kind, picking the lowest group id deterministically", async () => {
		const tenant = await find("u1", { kind: "clinic" });
		expect(tenant?.slug).toBe("clinic-a");
	});

	it("resolves raw against slug or id string", async () => {
		await expect(find("u1", { raw: "org-b" })).resolves.toMatchObject({ slug: "org-b" });
		await expect(find("u1", { raw: "3" })).resolves.toMatchObject({ slug: "cohort-c" });
		// Non-string raw values compare through String().
		await expect(find("u1", { raw: 4 })).resolves.toMatchObject({ slug: "clinic-d" });
	});

	it("requires every present selector field to match (AND semantics)", async () => {
		await expect(find("u1", { slug: "clinic-a", kind: "org" })).resolves.toBeNull();
		await expect(find("u1", { slug: "clinic-a", id: 2 })).resolves.toBeNull();
	});

	it("returns null for unknown selectors and foreign tenants", async () => {
		await expect(find("u1", { slug: "no-such-clinic" })).resolves.toBeNull();
		await expect(find("u1", { id: 999 })).resolves.toBeNull();
		await expect(find("u1", { kind: "unknown-kind" })).resolves.toBeNull();
		await expect(find("u1", { raw: "not-a-tenant" })).resolves.toBeNull();
		// Non-scalar raw values never match.
		await expect(find("u1", { raw: { unexpected: true } })).resolves.toBeNull();
		// u2 belongs only to org-b — clinic-a is a foreign tenant.
		await expect(find("u2", { slug: "clinic-a" })).resolves.toBeNull();
		await expect(find("nobody", { slug: "clinic-a" })).resolves.toBeNull();
	});

	it("returns null for an empty selector", async () => {
		await expect(find("u1", {})).resolves.toBeNull();
	});

	it("propagates query failures", async () => {
		const broken = makeTenantDirectory(makeDb(makeD1()));
		const exit = await Effect.runPromiseExit(broken.findBySelector("u1", { slug: "x" }));
		expect(exit._tag).toBe("Failure");
	});
});

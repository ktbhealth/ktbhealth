import { eq } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { Db, makeDb, type DbClient, type SqlDatabase } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";

import { Tenant, withTenantAccess } from "./index.ts";
import {
	accessibleTenantIds,
	scopedRepo,
	tenantScopeCondition,
	type ScopedRepo,
} from "./scoped-repo.ts";
import { tenantIdColumn, tenantTable } from "./schema.ts";

const notes = tenantTable("test_notes", {
	id: integer().primaryKey({ autoIncrement: true }),
	tenantId: tenantIdColumn(),
	body: text().notNull(),
});

const DDL =
	"CREATE TABLE test_notes (" +
	"id INTEGER PRIMARY KEY AUTOINCREMENT, " +
	"tenant_id INTEGER, " +
	"body TEXT NOT NULL" +
	")";

const tenantA: Tenant = { id: 1, kind: "clinic", slug: "a", role: "member" };
const tenantB: Tenant = { id: 2, kind: "clinic", slug: "b", role: "member" };

interface Fixture {
	readonly sql: SqlDatabase;
	readonly db: DbClient;
	readonly live: Layer.Layer<Db>;
	readonly ids: { a1: number; a2: number; b1: number; p1: number };
}

const makeFixture = async (): Promise<Fixture> => {
	const sql = makeD1(DDL);
	const ins = (tenantId: number | null, body: string) =>
		sql
			.prepare("INSERT INTO test_notes (tenant_id, body) VALUES (?, ?)")
			.bind(tenantId, body)
			.run();
	await ins(1, "a1");
	await ins(1, "a2");
	await ins(2, "b1");
	await ins(null, "p1");
	const rows = await sql
		.prepare("SELECT id, tenant_id, body FROM test_notes ORDER BY id")
		.all<{ id: number; tenant_id: number | null; body: string }>();
	const byBody = new Map(rows.results.map((r) => [r.body, r.id]));
	const db = makeDb(sql);
	return {
		sql,
		db,
		live: Layer.succeed(Db, db),
		ids: {
			a1: byBody.get("a1")!,
			a2: byBody.get("a2")!,
			b1: byBody.get("b1")!,
			p1: byBody.get("p1")!,
		},
	};
};

const withTenant = <A, E>(
	tenant: Tenant | null,
	effect: Effect.Effect<A, E, Db>,
	live: Layer.Layer<Db>,
) => Effect.runPromise(effect.pipe(Effect.provide(live), Effect.provideService(Tenant, tenant)));

const repo = <A, E>(
	f: Fixture,
	tenant: Tenant | null,
	fn: (r: ScopedRepo<typeof notes>) => Effect.Effect<A, E, never>,
) => withTenant(tenant, scopedRepo(notes).pipe(Effect.flatMap(fn)), f.live);

describe("accessibleTenantIds", () => {
	it("derives the active tenant's id", async () => {
		await expect(
			Effect.runPromise(Effect.provideService(accessibleTenantIds, Tenant, tenantA)),
		).resolves.toEqual([1]);
	});

	it("is empty in personal scope", async () => {
		await expect(Effect.runPromise(accessibleTenantIds)).resolves.toEqual([]);
	});

	it("prefers an explicit TenantAccess set", async () => {
		await expect(
			Effect.runPromise(
				withTenantAccess([4, 5], accessibleTenantIds).pipe(Effect.provideService(Tenant, tenantA)),
			),
		).resolves.toEqual([4, 5]);
	});
});

describe("tenantScopeCondition", () => {
	it("produces a SQL condition for any scope", async () => {
		const condition = await Effect.runPromise(
			tenantScopeCondition(notes).pipe(Effect.provideService(Tenant, tenantA)),
		);
		expect(condition).toBeDefined();
	});
});

describe("scopedRepo reads", () => {
	it("findMany returns own-tenant plus personal rows only", async () => {
		const f = await makeFixture();
		const rows = await repo(f, tenantA, (r) => r.findMany());
		expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual(
			[f.ids.a1, f.ids.a2, f.ids.p1].sort((a, b) => a - b),
		);
	});

	it("findMany for tenant B mirrors the scope", async () => {
		const f = await makeFixture();
		const rows = await repo(f, tenantB, (r) => r.findMany());
		expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual(
			[f.ids.b1, f.ids.p1].sort((a, b) => a - b),
		);
	});

	it("personal scope sees only NULL-tenant rows", async () => {
		const f = await makeFixture();
		const rows = await repo(f, null, (r) => r.findMany());
		expect(rows.map((r) => r.id)).toEqual([f.ids.p1]);
	});

	it("findFirst returns the first in-scope row", async () => {
		const f = await makeFixture();
		const row = await repo(f, tenantB, (r) => r.findFirst());
		expect(row?.id).toBe(f.ids.b1);
	});

	it("TenantAccess widens the visible set across tenants", async () => {
		const f = await makeFixture();
		const rows = await withTenant(
			null,
			scopedRepo(notes).pipe(Effect.flatMap((r) => r.findMany())),
			f.live,
		);
		// baseline personal: only p1
		expect(rows.map((r) => r.id)).toEqual([f.ids.p1]);

		const wide = await Effect.runPromise(
			withTenantAccess(
				[1, 2],
				scopedRepo(notes).pipe(
					Effect.flatMap((r) => r.findMany()),
					Effect.provide(f.live),
				),
			),
		);
		expect(wide.map((r) => r.id).sort((a, b) => a - b)).toEqual(
			[f.ids.a1, f.ids.a2, f.ids.b1, f.ids.p1].sort((a, b) => a - b),
		);
	});
});

describe("scopedRepo writes", () => {
	it("insert stamps the active tenant id", async () => {
		const f = await makeFixture();
		const row = await repo(f, tenantA, (r) => r.insert({ body: "new-a" }));
		expect(row?.tenantId).toBe(1);
	});

	it("insert in personal scope stamps NULL", async () => {
		const f = await makeFixture();
		const row = await repo(f, null, (r) => r.insert({ body: "new-p" }));
		expect(row?.tenantId).toBeNull();
	});

	it("update cannot touch foreign-tenant rows", async () => {
		const f = await makeFixture();
		const updated = await repo(f, tenantA, (r) =>
			r.update({ body: "hijack" }).where(eq(notes.id, f.ids.b1)),
		);
		expect(updated).toEqual([]);
		const check = await f.db.select().from(notes).where(eq(notes.id, f.ids.b1));
		expect(check[0]?.body).toBe("b1");
	});

	it("update drops tenantId from the patch", async () => {
		const f = await makeFixture();
		const updated = await repo(f, tenantA, (r) =>
			r.update({ body: "moved?", tenantId: 2 }).where(eq(notes.id, f.ids.a1)),
		);
		expect(updated).toHaveLength(1);
		const check = await f.db.select().from(notes).where(eq(notes.id, f.ids.a1));
		expect(check[0]?.tenantId).toBe(1);
		expect(check[0]?.body).toBe("moved?");
	});

	it("remove cannot delete foreign-tenant rows", async () => {
		const f = await makeFixture();
		const removed = await repo(f, tenantA, (r) => r.remove(eq(notes.id, f.ids.b1)));
		expect(removed).toEqual([]);
		const remaining = await repo(f, tenantB, (r) => r.findMany());
		expect(remaining.map((r) => r.id)).toContain(f.ids.b1);
	});

	it("remove deletes in-scope rows", async () => {
		const f = await makeFixture();
		const removed = await repo(f, tenantA, (r) => r.remove(eq(notes.id, f.ids.a2)));
		expect(removed).toHaveLength(1);
		const rows = await repo(f, tenantA, (r) => r.findMany());
		expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual(
			[f.ids.a1, f.ids.p1].sort((a, b) => a - b),
		);
	});
});

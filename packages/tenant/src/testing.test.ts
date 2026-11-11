import { integer, text } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import type { SqlDatabase } from "@ktb/db";

import { scopedRepo } from "./scoped-repo.ts";
import { tenantIdColumn, tenantTable } from "./schema.ts";
import { tenantIsolationSuite, type TenantIsolationFixture } from "./testing.ts";

/**
 * Exercises the shared isolation harness on the default in-memory
 * SQLite engine — the same suite a plugin runs per supported engine.
 */
const docs = tenantTable("harness_docs", {
	id: integer().primaryKey({ autoIncrement: true }),
	tenantId: tenantIdColumn(),
	title: text().notNull(),
});

const DDL =
	"CREATE TABLE harness_docs (" +
	"id INTEGER PRIMARY KEY AUTOINCREMENT, " +
	"tenant_id INTEGER, " +
	"title TEXT NOT NULL" +
	")";

const tenantA = { id: 1, kind: "clinic", slug: "a", role: "member" as const };
const tenantB = { id: 2, kind: "clinic", slug: "b", role: "member" as const };

const seed = async (db: SqlDatabase): Promise<TenantIsolationFixture> => {
	const ins = (tenantId: number | null, title: string) =>
		db
			.prepare("INSERT INTO harness_docs (tenant_id, title) VALUES (?, ?)")
			.bind(tenantId, title)
			.run();
	await ins(1, "a1");
	await ins(1, "a2");
	await ins(2, "b1");
	await ins(null, "p1");
	const rows = await db
		.prepare("SELECT id, tenant_id FROM harness_docs")
		.all<{ id: number; tenant_id: number | null }>();
	const bucket = (tenantId: number | null) =>
		rows.results.filter((r) => r.tenant_id === tenantId).map((r) => r.id);
	return {
		tenantA: bucket(1),
		tenantB: bucket(2),
		personal: bucket(null),
	};
};

tenantIsolationSuite({
	name: "tenant package isolation harness",
	table: docs,
	tenants: { a: tenantA, b: tenantB },
	setup: (db) => db.exec(DDL),
	seed,
	ids: () =>
		Effect.gen(function* () {
			const repo = yield* scopedRepo(docs);
			const rows = yield* repo.findMany();
			return rows.map((r) => r.id);
		}),
});

describe("tenantIsolationSuite contract", () => {
	it("is a function that registers describes", () => {
		expect(typeof tenantIsolationSuite).toBe("function");
	});
});

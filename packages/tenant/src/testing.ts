import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Db, makeDb, type DbClient, type SqlDatabase } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";

import type { TenantScopedTable } from "./scoped-repo.ts";
import { Tenant } from "./context.ts";

/**
 * Per-plugin tenant-isolation test harness (P-053) — the "identical
 * cross-tenant leak tests on every supported engine" contract. A plugin
 * declares its tenant table, per-engine database factories, DDL/seed
 * fixtures and a probe that lists visible row ids through `scopedRepo`;
 * the suite then asserts, on EVERY engine, that:
 *
 * - tenant A sees its own rows + personal (`tenant_id IS NULL`) rows,
 *   never tenant B's;
 * - tenant B mirrors A;
 * - personal scope (no `Tenant` bound) sees personal rows only.
 *
 * Engines are whatever the app can open — the default is in-memory
 * SQLite via `@ktb/db/testing`; D1/miniflare, better-sqlite3 files and
 * Postgres adapters all satisfy the `SqlDatabase` port. The probe MUST
 * go through `scopedRepo` (or another sanctioned path) — that is what
 * makes the suite a guard-bypass detector: a raw query in the probe
 * would leak and fail the assertions.
 */

/** One database engine the suite runs against. */
export interface TenantIsolationEngine {
	readonly name: string;
	readonly open: () => SqlDatabase | Promise<SqlDatabase>;
}

/** Row ids the seed created, bucketed by owning scope. `personal` rows
 * have `tenant_id NULL`; the suites treat them as visible to everyone. */
export interface TenantIsolationFixture {
	readonly tenantA: readonly unknown[];
	readonly tenantB: readonly unknown[];
	readonly personal: readonly unknown[];
}

export interface TenantIsolationConfig<T extends TenantScopedTable> {
	/** Suite label, e.g. "patients tenant isolation". */
	readonly name: string;
	/** The tenant-scoped table under test — documentation/lint anchor;
	 * the probe closes over it itself. */
	readonly table: T;
	/** The two tenant contexts rows are seeded under. Their `id`s MUST
	 * match the `tenant_id` values written by `seed`. */
	readonly tenants: { readonly a: Tenant; readonly b: Tenant };
	/** Databases to run against. Default: one in-memory SQLite engine. */
	readonly engines?: readonly TenantIsolationEngine[];
	/** Per-engine schema setup (CREATE TABLE …) on the raw port; the
	 * return value is ignored. */
	readonly setup: (db: SqlDatabase) => unknown;
	/** Per-engine fixtures; returns the seeded row ids by scope. */
	readonly seed: (db: SqlDatabase) => TenantIsolationFixture | Promise<TenantIsolationFixture>;
	/**
	 * The probe under test: an Effect requiring `Db` that returns the ids
	 * visible in the CURRENT tenant scope. Implement it with
	 * `scopedRepo(table).findMany()` — anything bypassing the scope
	 * factory will (correctly) fail the leak assertions.
	 */
	readonly ids: () => Effect.Effect<readonly unknown[], unknown, Db>;
}

const DEFAULT_ENGINES: readonly TenantIsolationEngine[] = [
	{ name: "sqlite", open: () => makeD1() },
];

/**
 * Register the isolation suite. Call at module top level of a
 * `*.test.ts` file — it expands to one `describe` per engine with the
 * shared leak assertions.
 */
export const tenantIsolationSuite = <T extends TenantScopedTable>(
	config: TenantIsolationConfig<T>,
): void => {
	const engines = config.engines ?? DEFAULT_ENGINES;
	describe(config.name, () => {
		for (const engine of engines) {
			describe(engine.name, () => {
				it("scopes reads to the active tenant plus personal rows", async () => {
					const sqlDb = await engine.open();
					await config.setup(sqlDb);
					const fixture = await config.seed(sqlDb);
					const db: DbClient = makeDb(sqlDb);
					const live = Layer.succeed(Db, db);

					const visible = (tenant: Tenant | null) =>
						Effect.runPromise(
							config.ids().pipe(Effect.provide(live), Effect.provideService(Tenant, tenant)),
						);

					const expectScope = async (
						tenant: Tenant | null,
						own: readonly unknown[],
						foreign: readonly unknown[],
					) => {
						const ids = await visible(tenant);
						for (const id of [...own, ...fixture.personal]) {
							expect(ids, `expected id ${String(id)} to be visible`).toContain(id);
						}
						for (const id of foreign) {
							expect(ids, `id ${String(id)} leaked across tenants`).not.toContain(id);
						}
					};

					await expectScope(config.tenants.a, fixture.tenantA, fixture.tenantB);
					await expectScope(config.tenants.b, fixture.tenantB, fixture.tenantA);
					// Personal scope: own = nothing tenant-owned, foreign = both.
					const personalIds = await visible(null);
					for (const id of fixture.personal) {
						expect(personalIds).toContain(id);
					}
					for (const id of [...fixture.tenantA, ...fixture.tenantB]) {
						expect(
							personalIds,
							`tenant row ${String(id)} leaked into personal scope`,
						).not.toContain(id);
					}
				});
			});
		}
	});
};

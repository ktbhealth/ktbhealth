import { and, inArray, isNull, or, type Column, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";

import { Db } from "@ktb/db";

import { Tenant, TenantAccess } from "./context.ts";

/**
 * Tenant-scoped data access — the portable, non-bypassable isolation
 * baseline (P-053). Works identically on SQLite, D1 and Postgres; RLS
 * (see `./rls`) is defense-in-depth on top, never the contract.
 *
 * A table opts in by declaring a `tenantId` column mapped to
 * `tenant_id` (see `tenantTable`/`tenantIdColumn` in `./schema`) and by
 * being queried ONLY through {@link scopedRepo} — `ktb-arch/tenant-scope`
 * bans raw drizzle access to declared tenant tables outside this
 * factory.
 */

/** Any drizzle table carrying the conventional `tenantId` column. */
export type TenantScopedTable = SQLiteTable & { readonly tenantId: Column };

/**
 * The tenant ids the current scope may read: the explicit
 * {@link TenantAccess} set when bound, otherwise the active `Tenant`'s
 * id (empty in personal scope). Personal (`tenant_id IS NULL`) rows are
 * always visible — ownership of personal rows stays an authz concern
 * (e.g. `ownerId` checks), tenant scope only fences tenant-owned rows.
 */
export const accessibleTenantIds = Effect.gen(function* () {
	const access = yield* TenantAccess;
	if (access !== null) return access;
	const tenant = yield* Tenant;
	return tenant === null ? [] : [tenant.id];
});

/**
 * The WHERE fragment every scoped read/write carries:
 * `tenant_id IN (<accessible set>) OR tenant_id IS NULL`. With an empty
 * accessible set this degrades to `tenant_id IS NULL` — personal scope
 * sees personal rows only.
 */
export const tenantScopeCondition = <T extends TenantScopedTable>(table: T) =>
	Effect.map(accessibleTenantIds, (ids): SQL | undefined => {
		const column = table.tenantId;
		return ids.length === 0 ? isNull(column) : or(inArray(column, ids as never), isNull(column));
	});

/** Rows a scoped repo returns — drizzle's select model for `T`. */
export type ScopedRows<T extends TenantScopedTable> = T["$inferSelect"][];

/**
 * A query builder pre-filtered to the caller's accessible tenant set.
 * Reads (`findMany`/`findFirst`) always carry the scope condition;
 * writes (`insert`/`update`/`remove`) are fenced by it too — `insert`
 * stamps `tenant_id` with the active tenant (NULL in personal scope),
 * `update` refuses to move rows across the scope (a `tenantId` key in
 * the patch is dropped), and `update`/`remove` AND the caller's extra
 * condition with the scope so foreign-tenant rows are untouchable.
 */
export interface ScopedRepo<T extends TenantScopedTable> {
	readonly findMany: () => Effect.Effect<ScopedRows<T>>;
	readonly findFirst: () => Effect.Effect<T["$inferSelect"] | null>;
	readonly insert: (values: T["$inferInsert"]) => Effect.Effect<T["$inferSelect"] | null>;
	readonly update: (values: Partial<T["$inferInsert"]>) => {
		readonly where: (condition?: SQL) => Effect.Effect<ScopedRows<T>>;
	};
	readonly remove: (condition?: SQL) => Effect.Effect<ScopedRows<T>>;
}

/**
 * Build the scoped repo for a tenant table. Requires `Db` (the drizzle
 * client) and reads `Tenant`/`TenantAccess` from the request scope —
 * call it inside domain services, never at module top level.
 */
export const scopedRepo = <T extends TenantScopedTable>(
	table: T,
): Effect.Effect<ScopedRepo<T>, never, Db> =>
	Effect.gen(function* () {
		const db = yield* Db;
		const tenant = yield* Tenant;
		const scope = yield* tenantScopeCondition(table);

		return {
			findMany: () =>
				Effect.promise(
					() =>
						db
							.select()
							.from(table)
							.where(scope as SQL) as Promise<ScopedRows<T>>,
				),
			findFirst: () =>
				Effect.promise(async () => {
					const rows = (await db
						.select()
						.from(table)
						.where(scope as SQL)
						.limit(1)) as ScopedRows<T>;
					return rows[0] ?? null;
				}),
			insert: (values) =>
				Effect.promise(async () => {
					const rows = (await db
						.insert(table)
						.values({ ...values, tenantId: tenant?.id ?? null } as T["$inferInsert"])
						.returning()) as ScopedRows<T>;
					return rows[0] ?? null;
				}),
			update: (values) => ({
				where: (condition) => {
					// tenantId is owned by the scope, not by patches — dropping
					// it here keeps a row from being moved into (or out of)
					// another tenant through the update path.
					const patch = { ...values } as Record<string, unknown>;
					delete patch.tenantId;
					return Effect.promise(
						() =>
							db
								.update(table)
								.set(patch as Partial<T["$inferInsert"]>)
								.where(and(scope as SQL, condition))
								.returning() as Promise<ScopedRows<T>>,
					);
				},
			}),
			remove: (condition) =>
				Effect.promise(
					() =>
						db
							.delete(table)
							.where(and(scope as SQL, condition))
							.returning() as Promise<ScopedRows<T>>,
				),
		};
	});

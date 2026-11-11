import * as Effect from "effect/Effect";

import { Binding } from "@ktb/db";

/**
 * Postgres Row-Level Security for tenant tables — progressive
 * enhancement on top of the portable `scopedRepo` baseline (P-053).
 *
 * RLS only exists on Postgres; on SQLite/D1 these helpers are a
 * dialect-detected no-op. Isolation must NEVER depend on RLS being
 * applied — `scopedRepo` + `ktb-arch/tenant-scope` are the contract;
 * policies are defense-in-depth for engines that support them.
 */

/** SQL dialect of the deployment's database — supplied by the
 * composition root, which knows its engine. There is no reliable way to
 * detect it from the `SqlDatabase` port. */
export type TenantSqlDialect = "postgres" | "sqlite" | "d1" | "other";

export interface TenantRlsTable {
	/** Table name as it appears in the database. */
	readonly name: string;
	/** Tenant column name. Default `"tenant_id"`. */
	readonly tenantIdColumn?: string;
	/** Policy name. Default `<table>_tenant_isolation`. */
	readonly policyName?: string;
}

export interface TenantRlsOptions {
	/** GUC the policies read — set per request/transaction to the
	 * accessible tenant ids, e.g. `app.tenant_ids`. Default
	 * `"app.tenant_ids"`. */
	readonly setting?: string;
	/** Array element type for the `current_setting(...)::T[]` cast.
	 * Default `"bigint"` — covers serial/identity and text-free integer
	 * ids; pass `"text"` for uuid-keyed tenants. */
	readonly idType?: "int" | "bigint" | "text";
}

const quoteIdent = (ident: string) => `"${ident.replaceAll('"', '""')}"`;

/**
 * The SQL statements enabling tenant RLS on one table:
 *
 * ```sql
 * ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "patients_tenant_isolation" ON "patients"
 *   USING ("tenant_id" = ANY (current_setting('app.tenant_ids', true)::bigint[])
 *          OR "tenant_id" IS NULL);
 * ```
 *
 * `current_setting(..., true)` (missing_ok) yields NULL when unset →
 * the `= ANY` arm is NULL/false → only personal rows pass: fail closed.
 * The `IS NULL` arm mirrors the `scopedRepo` baseline — personal rows
 * are visible to every scope; tenant rows require membership.
 */
export const tenantRlsStatements = (
	table: string | TenantRlsTable,
	options: TenantRlsOptions = {},
): readonly string[] => {
	const name = typeof table === "string" ? table : table.name;
	const column = typeof table === "string" ? "tenant_id" : (table.tenantIdColumn ?? "tenant_id");
	const policy =
		typeof table === "string"
			? `${name}_tenant_isolation`
			: (table.policyName ?? `${name}_tenant_isolation`);
	const setting = options.setting ?? "app.tenant_ids";
	const idType = options.idType ?? "bigint";
	return [
		`ALTER TABLE ${quoteIdent(name)} ENABLE ROW LEVEL SECURITY`,
		`CREATE POLICY ${quoteIdent(policy)} ON ${quoteIdent(name)} ` +
			`USING (${quoteIdent(column)} = ANY (current_setting('${setting}', true)::${idType}[]) ` +
			`OR ${quoteIdent(column)} IS NULL)`,
	];
};

export interface TenantRlsResult {
	/** Table names the policies were applied to (postgres only). */
	readonly applied: readonly string[];
	/** The dialect that caused the no-op, or `null` when applied. */
	readonly skipped: TenantSqlDialect | null;
}

/**
 * Apply {@link tenantRlsStatements} for every declared tenant table.
 * No-op unless `dialect === "postgres"` — returns
 * `{ applied: [], skipped: <dialect> }` on sqlite/D1/other so callers
 * can apply unconditionally at boot/migration time.
 *
 * Requires the `Binding` port (the raw `SqlDatabase`); statements run
 * through `exec` sequentially — wrap in a migration/boot step, not a
 * hot path.
 */
export const applyTenantRls = (options: {
	readonly dialect: TenantSqlDialect;
	readonly tables: readonly (string | TenantRlsTable)[];
	readonly rls?: TenantRlsOptions;
}): Effect.Effect<TenantRlsResult, unknown, Binding> =>
	Effect.gen(function* () {
		if (options.dialect !== "postgres") {
			return { applied: [], skipped: options.dialect } as const;
		}
		const binding = yield* Binding;
		const names: string[] = [];
		for (const table of options.tables) {
			for (const statement of tenantRlsStatements(table, options.rls)) {
				yield* Effect.promise(() => binding.exec(statement));
			}
			names.push(typeof table === "string" ? table : table.name);
		}
		return { applied: names, skipped: null } as const;
	});

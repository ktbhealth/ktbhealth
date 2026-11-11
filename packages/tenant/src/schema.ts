import { integer } from "drizzle-orm/sqlite-core";
import { sqliteTable } from "drizzle-orm/sqlite-core";

/**
 * Declaration helpers for tenant-scoped tables (P-053).
 *
 * `tenantTable` is `sqliteTable` under a name that marks intent: the
 * `ktb-arch/tenant-scope` lint rule treats any table declared through it
 * (and re-exported from a schema module) as tenant-scoped and
 * bans raw drizzle queries on it outside `scopedRepo` (@ktb/tenant).
 * Postgres-backed apps declare their tables with `pgTable` + a
 * `tenant_id` column instead — the lint marker is the `tenantTable`
 * call name, so pg apps should alias `pgTable` the same way or rely on
 * the review contract; `scopedRepo` itself is dialect-agnostic.
 */
export const tenantTable = sqliteTable;

/**
 * The conventional tenant column: JS property `tenantId`, SQL column
 * `tenant_id`, nullable — `NULL` means personal scope. Pair it with a
 * `tenantTable(...)` declaration:
 *
 * ```ts
 * export const notes = tenantTable("notes", {
 *   id: integer().primaryKey({ autoIncrement: true }),
 *   tenantId: tenantIdColumn(),
 *   ...
 * });
 * ```
 */
export const tenantIdColumn = () => integer("tenant_id");

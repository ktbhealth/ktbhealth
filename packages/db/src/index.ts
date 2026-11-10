import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";

import * as schema from "./schema.ts";

/**
 * SqlDatabase — the DB port's currency: async SQLite behind a
 * prepared-statement surface (`prepare`/`bind`/`run`/`all`/`first`/
 * `raw`/`batch`/`exec`). This is a provider-neutral contract, not a
 * Cloudflare one: D1, miniflare's local D1 (dev), and the better-sqlite3
 * test shim all satisfy it, and any SQLite engine adapts with ~50 lines.
 * The deploy target adapts its native binding to `SqlDatabase` before
 * wiring `Binding` — provider types never cross this boundary.
 */
export interface SqlResultMeta {
	readonly changes?: number;
	readonly last_row_id?: number;
	readonly duration?: number;
	readonly rows_read?: number;
	readonly rows_written?: number;
	readonly size_after?: number;
	readonly [key: string]: unknown;
}

export interface SqlResult<T = unknown> {
	readonly results: T[];
	readonly success: boolean;
	readonly meta: SqlResultMeta;
	readonly error?: string;
}

export interface SqlStatement {
	bind(...values: unknown[]): SqlStatement;
	first<T = unknown>(colName?: string): Promise<T | null>;
	run(): Promise<SqlResult>;
	all<T = unknown>(): Promise<SqlResult<T>>;
	raw<T = unknown[]>(): Promise<T[]>;
}

export interface SqlDatabase {
	prepare(query: string): SqlStatement;
	dump(): Promise<ArrayBuffer>;
	batch<T = unknown>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
	exec(query: string): Promise<{ count: number; duration: number }>;
}

/**
 * Build the drizzle client over any `SqlDatabase`. The d1 driver is used
 * because it speaks exactly this prepared-statement wire shape — the
 * "d1" name is historical, the contract is `SqlDatabase`.
 */
export const makeDb = (database: SqlDatabase) =>
	drizzle(database as unknown as AnyD1Database, { schema });
export type DbClient = ReturnType<typeof makeDb>;

// Ports: the platform supplies a SqlDatabase; the lib stays
// runtime-agnostic (workerd/D1, bun, or any SQLite adapter).
export class Binding extends Context.Service<Binding, SqlDatabase>()("@ktb/db/Binding") {}
export class Db extends Context.Service<Db, DbClient>()("@ktb/db/Db") {}
export const DbLive = Layer.effect(Db, Effect.map(Binding, makeDb));

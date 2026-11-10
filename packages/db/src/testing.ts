import Database from "better-sqlite3";

import type { SqlDatabase } from "./index.ts";

/** In-memory SqlDatabase shim over better-sqlite3 — real SQL for tests. */
export function makeD1(sql?: string): SqlDatabase {
	const sqlite = new Database(":memory:");
	if (sql) sqlite.exec(sql);

	const prepared = (stmt: Database.Statement) => ({
		bind: (...values: unknown[]) =>
			prepared(stmt.bind(...values.map((v) => (v === undefined ? null : v)))),
		run: async () => {
			const r = stmt.run();
			return {
				success: true,
				results: [],
				meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) },
			};
		},
		all: async <T = Record<string, unknown>>() => ({
			success: true,
			results: stmt.all() as T[],
			meta: {},
		}),
		first: async <T = Record<string, unknown>>() => (stmt.get() as T) ?? null,
		raw: async <T = unknown[]>() => stmt.raw().all() as T[],
		// better-sqlite3 flag: true for SELECT-like statements
		get reader() {
			return stmt.reader;
		},
	});

	return {
		prepare: (q: string) => prepared(sqlite.prepare(q)),
		dump: async () => new ArrayBuffer(0),
		batch: async <T = unknown>(stmts: unknown[]) =>
			Promise.all(
				stmts.map(async (s) => {
					const p = s as {
						reader?: boolean;
						all: () => Promise<T>;
						run: () => Promise<unknown>;
					};
					return p.reader ? await p.all() : await p.run();
				}),
			),
		exec: async (q: string) => {
			sqlite.exec(q);
			return { count: 0, duration: 0 };
		},
	} as unknown as SqlDatabase;
}

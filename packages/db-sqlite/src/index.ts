import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import type { SqlResult, SqlDatabase, SqlStatement } from "@ktb/db";

import { applyMigrations } from "./migrate.ts";

/**
 * @ktb/db-sqlite — SqlDatabase adapter over better-sqlite3 for runtimes
 * without a hosted SQLite binding (plain Node/Bun dev, non-Cloudflare
 * deploy targets). NOT for workerd: the native binding cannot load
 * there — Cloudflare targets keep passing their D1 binding as
 * `AppEnv.DB`.
 *
 * The returned object satisfies the same prepared-statement surface as
 * D1 (`prepare`/`bind`/`run`/`all`/`first`/`raw`/`batch`/`exec`/`dump`),
 * so `makeDb`/`drizzle-orm/d1` consume it unchanged.
 */

export interface SqliteDatabaseOptions {
	/**
	 * Filesystem path, `":memory:"`, or a `sqlite:`/`file:` URL — see
	 * {@link sqliteFilename}. Default `":memory:"`.
	 */
	readonly filename?: string;
	/** Open read-only. Default false. */
	readonly readonly?: boolean;
	/** `PRAGMA busy_timeout` ms — how long to wait on a locked db.
	 * Default 5000 (dev-friendly when a seed script and the server hold
	 * the file concurrently). */
	readonly busyTimeout?: number;
	/** `PRAGMA foreign_keys`. Default true — matches D1, which enforces
	 * foreign keys. */
	readonly foreignKeys?: boolean;
	/**
	 * `PRAGMA journal_mode` for file-backed dbs. Default `"wal"` — lets a
	 * second process (seed script, sqlite CLI) read while the dev server
	 * writes. Ignored for `":memory:"`.
	 */
	readonly journalMode?: "wal" | "delete" | "truncate" | "persist" | "memory" | "off";
	/**
	 * Directory of drizzle-kit migrations (`packages/db/drizzle`) or a
	 * flat alchemy-migrations dir — applied synchronously before the
	 * adapter is returned. See `./migrate`.
	 */
	readonly migrate?: string;
}

/** Database handle plus lifecycle — the SqlDatabase surface plus close(). */
export interface SqliteDatabase extends SqlDatabase {
	close(): void;
}

/**
 * Normalize a DATABASE_URL-style value to a better-sqlite3 filename.
 * Accepted forms: `":memory:"`, `"./data/app.db"`, `"sqlite:./x.db"`,
 * `"sqlite::memory:"`, `"file:./x.db"`, `"file:///abs/x.db"`.
 */
export const sqliteFilename = (input: string): string => {
	let s = input.trim();
	if (s === "") return ":memory:";
	if (s.startsWith("sqlite://")) s = s.slice("sqlite://".length);
	else if (s.startsWith("sqlite:")) s = s.slice("sqlite:".length);
	if (s.startsWith("file://")) return fileURLToPath(s);
	if (s.startsWith("file:")) s = s.slice("file:".length);
	return s;
};

/** Map JS bind values onto better-sqlite3's accepted set. */
const bindable = (values: readonly unknown[]): unknown[] =>
	values.map((v) => {
		if (v === undefined || v === null) return null;
		if (typeof v === "boolean") return v ? 1 : 0;
		return v;
	});

interface BoundStatement {
	readonly stmt: Database.Statement;
	readonly values: readonly unknown[];
}

/**
 * Open a file (or `":memory:"`) SQLite database as a `SqlDatabase`.
 * The parent directory of a file path is created automatically.
 */
export const makeSqliteDatabase = (
	filenameOrOptions: string | SqliteDatabaseOptions = ":memory:",
	options: SqliteDatabaseOptions = {},
): SqliteDatabase => {
	const opts: SqliteDatabaseOptions =
		typeof filenameOrOptions === "string"
			? { ...options, filename: filenameOrOptions }
			: filenameOrOptions;
	const filename = sqliteFilename(opts.filename ?? ":memory:");

	if (filename !== ":memory:") {
		mkdirSync(dirname(filename), { recursive: true });
	}

	const sqlite = new Database(filename, { readonly: opts.readonly ?? false });
	sqlite.pragma(`busy_timeout = ${opts.busyTimeout ?? 5000}`);
	sqlite.pragma(`foreign_keys = ${opts.foreignKeys === false ? "OFF" : "ON"}`);
	if (filename !== ":memory:") {
		sqlite.pragma(`journal_mode = ${opts.journalMode ?? "WAL"}`);
	}

	if (opts.migrate !== undefined) {
		applyMigrations(sqlite, opts.migrate);
	}

	const now = () => performance.now();

	const runBound = (b: BoundStatement): SqlResult => {
		const start = now();
		if (b.stmt.reader) {
			return {
				success: true,
				results: b.stmt.all(...bindable(b.values)) as unknown[],
				meta: { duration: now() - start },
			};
		}
		const r = b.stmt.run(...bindable(b.values));
		return {
			success: true,
			results: [],
			meta: {
				changes: r.changes,
				last_row_id: Number(r.lastInsertRowid),
				duration: now() - start,
			},
		};
	};

	const allBound = <T>(b: BoundStatement): SqlResult<T> => {
		const start = now();
		if (!b.stmt.reader) {
			// D1 executes the statement and returns an empty result set.
			const r = b.stmt.run(...bindable(b.values));
			return {
				success: true,
				results: [],
				meta: {
					changes: r.changes,
					last_row_id: Number(r.lastInsertRowid),
					duration: now() - start,
				},
			};
		}
		return {
			success: true,
			results: b.stmt.all(...bindable(b.values)) as T[],
			meta: { duration: now() - start },
		};
	};

	const statement = (b: BoundStatement): SqlStatement => {
		const s = {
			bind: (...values: unknown[]) => statement({ ...b, values }),
			run: async () => runBound(b),
			all: async <T = unknown>() => allBound<T>(b),
			first: async <T = unknown>(colName?: string) => {
				if (!b.stmt.reader) {
					b.stmt.run(...bindable(b.values));
					return null;
				}
				const row = b.stmt.get(...bindable(b.values)) as Record<string, unknown> | undefined;
				if (row === undefined) return null;
				if (colName !== undefined) return (row[colName] ?? null) as T | null;
				return row as T;
			},
			raw: async <T = unknown[]>() => {
				if (!b.stmt.reader) {
					b.stmt.run(...bindable(b.values));
					return [] as T;
				}
				return b.stmt.raw().all(...bindable(b.values)) as T;
			},
		};
		// Carry the bound params so batch() can run statements inside a
		// single better-sqlite3 transaction. Not part of the SqlStatement
		// contract — structural only.
		return Object.assign(s, { [BOUND]: b });
	};

	return {
		prepare: (query: string) => statement({ stmt: sqlite.prepare(query), values: [] }),
		dump: async () => {
			const buf = sqlite.serialize();
			const out = new ArrayBuffer(buf.byteLength);
			new Uint8Array(out).set(buf);
			return out;
		},
		batch: async <T = unknown>(statements: SqlStatement[]) => {
			const bounds = statements.map((s) => (s as unknown as Record<symbol, unknown>)[BOUND]);
			if (bounds.every((b): b is BoundStatement => isBoundStatement(b))) {
				// D1 batches run atomically; better-sqlite3 transactions
				// give the same all-or-nothing semantics.
				const tx = sqlite.transaction((bs: BoundStatement[]) =>
					bs.map((b) => runBound(b) as SqlResult<T>),
				);
				return tx(bounds);
			}
			// Foreign statements (another SqlDatabase impl): fall back to
			// sequential execution — reader statements via all(), writers
			// via run(), same convention as the test shim.
			return Promise.all(
				statements.map(async (s) => {
					const p = s as {
						reader?: boolean;
						all: () => Promise<SqlResult<T>>;
						run: () => Promise<SqlResult<T>>;
					};
					return p.reader ? await p.all() : await p.run();
				}),
			);
		},
		exec: async (query: string) => {
			const start = now();
			sqlite.exec(query);
			return { count: 0, duration: now() - start };
		},
		close: () => sqlite.close(),
	};
};

const BOUND = Symbol("ktb.db-sqlite.bound");

const isBoundStatement = (b: unknown): b is BoundStatement =>
	typeof b === "object" && b !== null && "stmt" in b && "values" in b;

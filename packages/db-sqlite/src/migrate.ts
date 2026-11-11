import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";

import type { SqlDatabase } from "@ktb/db";

/**
 * Migration runner for @ktb/db-sqlite — applies the same SQL files
 * `drizzle-kit generate` emits (packages/db/drizzle) or the flat
 * alchemy-migrations copy, tracking applied files in
 * `__ktb_migrations`. Provider-neutral: `runMigrations` works against
 * any SqlDatabase (D1 included); `applyMigrations`/`migrateSqliteFile`
 * are the synchronous better-sqlite3 variants used by makeSqliteDatabase
 * and scripts.
 */

const TRACKING_TABLE = "__ktb_migrations";

interface Journal {
	readonly entries?: readonly { readonly idx: number; readonly tag: string }[];
}

/**
 * Ordered migration names for a directory: the drizzle-kit journal
 * (`meta/_journal.json`) when present, otherwise every `*.sql` file in
 * sorted order (the alchemy-migrations flat layout).
 */
export const listMigrations = (migrationsDir: string): string[] => {
	const journalPath = join(migrationsDir, "meta", "_journal.json");
	if (existsSync(journalPath)) {
		const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
		return (journal.entries ?? [])
			.slice()
			.sort((a, b) => a.idx - b.idx)
			.map((e) => `${e.tag}.sql`);
	}
	return readdirSync(migrationsDir)
		.filter((f) => f.endsWith(".sql"))
		.sort();
};

const appliedNames = (sqlite: Database.Database): Set<string> => {
	sqlite.exec(
		`CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (` +
			`name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)`,
	);
	const rows = sqlite.prepare(`SELECT name FROM ${TRACKING_TABLE}`).all() as { name: string }[];
	return new Set(rows.map((r) => r.name));
};

/**
 * A database that already has user tables but no migration records was
 * not created by this runner (e.g. a file exported from another tool).
 * Refuse rather than half-apply DDL on top of an unknown schema.
 */
const assertNotForeignSchema = (sqlite: Database.Database, applied: Set<string>) => {
	if (applied.size > 0) return;
	const others = sqlite
		.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' ` +
				`AND name NOT IN ('${TRACKING_TABLE}', 'sqlite_sequence')`,
		)
		.all() as { name: string }[];
	if (others.length > 0) {
		throw new Error(
			`sqlite database already contains tables (${others
				.map((t) => t.name)
				.join(", ")}) but no ${TRACKING_TABLE} records — it was not ` +
				"created by this migration runner. Delete the file or baseline " +
				"it manually before migrating.",
		);
	}
};

/**
 * Synchronously apply pending migrations on an open better-sqlite3
 * handle. The whole run is one IMMEDIATE transaction: concurrent
 * openers (dev server double-eval, seed script) serialize on the write
 * lock instead of racing CREATE TABLEs, and a failure leaves the
 * database untouched. Returns applied names.
 */
export const applyMigrations = (sqlite: Database.Database, migrationsDir: string): string[] => {
	const run = sqlite.transaction(() => {
		const applied = appliedNames(sqlite);
		assertNotForeignSchema(sqlite, applied);
		const appliedNow: string[] = [];
		for (const name of listMigrations(migrationsDir)) {
			if (applied.has(name)) continue;
			const sql = readFileSync(join(migrationsDir, name), "utf8");
			// better-sqlite3 exec handles the whole file (comments included).
			sqlite.exec(sql);
			sqlite
				.prepare(`INSERT INTO ${TRACKING_TABLE} (name, applied_at) VALUES (?, ?)`)
				.run(name, Date.now());
			appliedNow.push(name);
		}
		return appliedNow;
	});
	return run.immediate();
};

/**
 * Open `filename`, apply pending migrations, close. Convenience for
 * scripts — `makeSqliteDatabase({ filename, migrate })` is the in-process
 * equivalent and also covers `":memory:"`.
 */
export const migrateSqliteFile = (filename: string, migrationsDir: string): string[] => {
	if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
	const sqlite = new Database(filename);
	try {
		return applyMigrations(sqlite, migrationsDir);
	} finally {
		sqlite.close();
	}
};

/**
 * Provider-neutral variant: apply pending migrations through the
 * SqlDatabase port (`exec`/`prepare`/`bind`/`run`), so the same runner
 * works on D1/miniflare and the sqlite adapter. Async because the port
 * is async.
 */
export const runMigrations = async (
	database: SqlDatabase,
	migrationsDir: string,
): Promise<string[]> => {
	await database.exec(
		`CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (` +
			`name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)`,
	);
	const appliedRows = await database
		.prepare(`SELECT name FROM ${TRACKING_TABLE}`)
		.all<{ name: string }>();
	const applied = new Set(appliedRows.results.map((r) => r.name));
	if (applied.size === 0) {
		const others = await database
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' ` +
					`AND name NOT IN ('${TRACKING_TABLE}', 'sqlite_sequence')`,
			)
			.all<{ name: string }>();
		if (others.results.length > 0) {
			throw new Error(
				`sqlite database already contains tables (${others.results
					.map((t) => t.name)
					.join(", ")}) but no ${TRACKING_TABLE} records — it was not ` +
					"created by this migration runner. Delete the file or baseline " +
					"it manually before migrating.",
			);
		}
	}
	const appliedNow: string[] = [];
	for (const name of listMigrations(migrationsDir)) {
		if (applied.has(name)) continue;
		const sql = readFileSync(join(migrationsDir, name), "utf8");
		await database.exec(sql);
		await database
			.prepare(`INSERT INTO ${TRACKING_TABLE} (name, applied_at) VALUES (?, ?)`)
			.bind(name, Date.now())
			.run();
		appliedNow.push(name);
	}
	return appliedNow;
};

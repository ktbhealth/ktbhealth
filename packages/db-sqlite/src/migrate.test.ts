import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeSqliteDatabase, type SqliteDatabase } from "./index.ts";
import { listMigrations, migrateSqliteFile, runMigrations } from "./migrate.ts";

const dirs: string[] = [];
const tmpDir = () => {
	const d = mkdtempSync(join(tmpdir(), "ktb-migrate-"));
	dirs.push(d);
	return d;
};
afterEach(() => {
	while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Build a fake migrations dir: flat .sql files, journal optional. */
const makeMigrationsDir = (files: Record<string, string>, withJournal = false) => {
	const dir = join(tmpDir(), "migrations");
	mkdirSync(dir, { recursive: true });
	for (const [name, sql] of Object.entries(files)) {
		writeFileSync(join(dir, name), sql);
	}
	if (withJournal) {
		mkdirSync(join(dir, "meta"), { recursive: true });
		writeFileSync(
			join(dir, "meta", "_journal.json"),
			JSON.stringify({
				version: "7",
				dialect: "sqlite",
				entries: Object.keys(files).map((name, idx) => ({
					idx,
					version: "6",
					when: idx,
					tag: name.replace(/\.sql$/, ""),
					breakpoints: true,
				})),
			}),
		);
	}
	return dir;
};

describe("listMigrations", () => {
	it("sorts flat .sql files without a journal", () => {
		const dir = makeMigrationsDir({ "0001_b.sql": "", "0000_a.sql": "" });
		expect(listMigrations(dir)).toEqual(["0000_a.sql", "0001_b.sql"]);
	});

	it("prefers journal order over filename sort", () => {
		// Journal entries are written in insertion order: 0001 gets idx 0,
		// 0000 gets idx 1 — the opposite of filename sort.
		const dir = makeMigrationsDir({ "0001_b.sql": "", "0000_a.sql": "" }, true);
		expect(listMigrations(dir)).toEqual(["0001_b.sql", "0000_a.sql"]);
	});
});

describe("migrateSqliteFile / makeSqliteDatabase migrate option", () => {
	it("applies pending migrations once and is idempotent", async () => {
		const dir = tmpDir();
		const file = join(dir, "app.db");
		const migrations = makeMigrationsDir({
			"0000_init.sql":
				"CREATE TABLE t (id INTEGER PRIMARY KEY);--> statement-breakpoint\nINSERT INTO t DEFAULT VALUES;",
		});

		expect(migrateSqliteFile(file, migrations)).toEqual(["0000_init.sql"]);
		expect(migrateSqliteFile(file, migrations)).toEqual([]);

		const check = makeSqliteDatabase(file);
		try {
			const row = await check.prepare("SELECT COUNT(*) AS c FROM t").first<{ c: number }>();
			expect(row?.c).toBe(1);
		} finally {
			check.close();
		}
	});

	it("refuses a database with tables but no migration records", async () => {
		const dir = tmpDir();
		const file = join(dir, "foreign.db");
		const foreign = makeSqliteDatabase(file);
		await foreign.exec("CREATE TABLE manual (id INTEGER)");
		foreign.close();
		const migrations = makeMigrationsDir({ "0000_init.sql": "CREATE TABLE t (id INTEGER)" });
		expect(() => migrateSqliteFile(file, migrations)).toThrow(/no __ktb_migrations records/);
	});

	it("applies migrations on open via the migrate option", async () => {
		const dir = tmpDir();
		const migrations = makeMigrationsDir({
			"0000_init.sql": "CREATE TABLE t (v TEXT)",
		});
		const db: SqliteDatabase = makeSqliteDatabase({
			filename: join(dir, "app.db"),
			migrate: migrations,
		});
		try {
			await db.prepare("INSERT INTO t VALUES (?)").bind("x").run();
			const row = await db.prepare("SELECT v FROM t").first<{ v: string }>();
			expect(row?.v).toBe("x");
		} finally {
			db.close();
		}
	});
});

describe("runMigrations (provider-neutral)", () => {
	it("applies through the SqlDatabase port and skips applied files", async () => {
		const migrations = makeMigrationsDir(
			{
				"0000_init.sql": "CREATE TABLE t (id INTEGER PRIMARY KEY)",
				"0001_more.sql": "CREATE TABLE u (id INTEGER PRIMARY KEY)",
			},
			true,
		);
		const db = makeSqliteDatabase(":memory:");
		try {
			expect(await runMigrations(db, migrations)).toEqual(["0000_init.sql", "0001_more.sql"]);
			expect(await runMigrations(db, migrations)).toEqual([]);
			const row = await db.prepare("SELECT name FROM sqlite_master WHERE name = 'u'").first();
			expect(row).not.toBeNull();
		} finally {
			db.close();
		}
	});
});

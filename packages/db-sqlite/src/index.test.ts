import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { makeDb } from "@ktb/db";

import { makeSqliteDatabase, sqliteFilename, type SqliteDatabase } from "./index.ts";

const dirs: string[] = [];
const tmpDir = () => {
	const d = mkdtempSync(join(tmpdir(), "ktb-sqlite-"));
	dirs.push(d);
	return d;
};
afterEach(() => {
	while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("sqliteFilename", () => {
	it("passes through plain paths and :memory:", () => {
		expect(sqliteFilename(":memory:")).toBe(":memory:");
		expect(sqliteFilename("./data/app.db")).toBe("./data/app.db");
		expect(sqliteFilename("sqlite:./x.db")).toBe("./x.db");
		expect(sqliteFilename("sqlite::memory:")).toBe(":memory:");
		expect(sqliteFilename("file:./x.db")).toBe("./x.db");
		expect(sqliteFilename("file:///tmp/x.db")).toBe("/tmp/x.db");
		expect(sqliteFilename("  ")).toBe(":memory:");
	});
});

describe("makeSqliteDatabase", () => {
	let db: SqliteDatabase | undefined;
	afterEach(() => db?.close());

	it("prepares, binds, runs, reads", async () => {
		db = makeSqliteDatabase(":memory:");
		await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");

		const ins = await db.prepare("INSERT INTO t (v) VALUES (?)").bind("hello").run();
		expect(ins.success).toBe(true);
		expect(ins.meta.changes).toBe(1);
		expect(ins.meta.last_row_id).toBe(1);

		const rows = await db.prepare("SELECT * FROM t WHERE v = ?").bind("hello").all<{
			id: number;
			v: string;
		}>();
		expect(rows.results[0]?.v).toBe("hello");

		const one = await db.prepare("SELECT v FROM t WHERE id = ?").bind(1).first<{ v: string }>();
		expect(one?.v).toBe("hello");

		const col = await db.prepare("SELECT v FROM t WHERE id = ?").bind(1).first("v");
		expect(col).toBe("hello");

		expect(await db.prepare("SELECT * FROM t WHERE id = ?").bind(999).first()).toBeNull();

		const raw = await db.prepare("SELECT v FROM t").raw<[string]>();
		expect(raw).toEqual([["hello"]]);
	});

	it("maps undefined binds to null and booleans to 1/0", async () => {
		db = makeSqliteDatabase(":memory:");
		await db.exec("CREATE TABLE t (a TEXT, b INTEGER)");
		await db.prepare("INSERT INTO t VALUES (?, ?)").bind(undefined, true).run();
		const row = await db.prepare("SELECT a, b FROM t").first<{ a: unknown; b: number }>();
		expect(row?.a).toBeNull();
		expect(row?.b).toBe(1);
	});

	it("batch executes atomically inside a transaction", async () => {
		db = makeSqliteDatabase(":memory:");
		await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
		const results = await db.batch([
			db.prepare("INSERT INTO t DEFAULT VALUES"),
			db.prepare("SELECT 1 AS one"),
		]);
		expect(results).toHaveLength(2);
		expect(results[0]?.meta.changes).toBe(1);
		const first = results[1]?.results[0] as { one: number } | undefined;
		expect(first?.one).toBe(1);

		// A failing statement rolls the whole batch back (duplicate PK —
		// prepare() can't detect it, the transaction does).
		await db.prepare("INSERT INTO t (id) VALUES (?)").bind(7).run();
		await expect(
			db.batch([
				db.prepare("INSERT INTO t (id) VALUES (?)").bind(8),
				db.prepare("INSERT INTO t (id) VALUES (?)").bind(7),
			]),
		).rejects.toThrow(/UNIQUE/);
		const count = await db.prepare("SELECT COUNT(*) AS c FROM t").first<{ c: number }>();
		expect(count?.c).toBe(2); // ids 1 and 7 — the rolled-back id 8 is gone
	});

	it("exec runs multi-statement SQL and reports duration", async () => {
		db = makeSqliteDatabase(":memory:");
		const res = await db.exec(
			"CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER); INSERT INTO a VALUES (1);",
		);
		expect(res.duration).toBeGreaterThanOrEqual(0);
	});

	it("dump returns a non-empty database image", async () => {
		db = makeSqliteDatabase(":memory:");
		await db.exec("CREATE TABLE t (id INTEGER)");
		const buf = await db.dump();
		expect(buf.byteLength).toBeGreaterThan(0);
		expect(buf).toBeInstanceOf(ArrayBuffer);
	});

	it("persists to a file across connections", async () => {
		const dir = tmpDir();
		const file = join(dir, "nested", "app.db");
		db = makeSqliteDatabase(`sqlite:${file}`);
		await db.exec("CREATE TABLE t (v TEXT)");
		await db.prepare("INSERT INTO t VALUES (?)").bind("persisted").run();
		db.close();

		const reopened = makeSqliteDatabase(file);
		try {
			const row = await reopened.prepare("SELECT v FROM t").first<{ v: string }>();
			expect(row?.v).toBe("persisted");
		} finally {
			reopened.close();
		}
		db = undefined;
	});

	it("enforces foreign keys like D1", async () => {
		db = makeSqliteDatabase(":memory:");
		await db.exec(
			"CREATE TABLE p (id INTEGER PRIMARY KEY);" +
				"CREATE TABLE c (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES p(id));",
		);
		await expect(db.prepare("INSERT INTO c (pid) VALUES (?)").bind(42).run()).rejects.toThrow(
			/FOREIGN KEY/,
		);
	});

	it("drives makeDb/drizzle queries", async () => {
		db = makeSqliteDatabase(":memory:");
		const orm = makeDb(db);
		await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
		await orm.run(sql`INSERT INTO t (v) VALUES ('via-drizzle')`);
		const rows = await orm.all(sql`SELECT v FROM t`);
		expect(rows[0]).toMatchObject({ v: "via-drizzle" });
	});
});

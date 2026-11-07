import { describe, expect, it } from "vitest";

import { makeD1 } from "./testing.ts";

describe("makeD1", () => {
	it("runs raw SQL via exec", async () => {
		const d1 = makeD1();
		const res = await d1.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
		expect(res.count).toBe(0);
	});

	it("prepares, binds, runs, and reads rows", async () => {
		const d1 = makeD1("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");

		const ins = await d1.prepare("INSERT INTO t (v) VALUES (?)").bind("hello").run();
		expect(ins.success).toBe(true);
		expect(ins.meta.changes).toBe(1);

		const rows = await d1.prepare("SELECT * FROM t WHERE v = ?").bind("hello").all<{
			id: number;
			v: string;
		}>();
		expect(rows.results[0]?.v).toBe("hello");

		const one = await d1.prepare("SELECT * FROM t WHERE id = ?").bind(1).first<{ v: string }>();
		expect(one?.v).toBe("hello");

		const missing = await d1.prepare("SELECT * FROM t WHERE id = ?").bind(999).first();
		expect(missing).toBeNull();

		const raw = await d1.prepare("SELECT v FROM t").raw();
		expect(raw).toBeDefined();
	});

	it("batch executes prepared statements", async () => {
		const d1 = makeD1("CREATE TABLE t (id INTEGER PRIMARY KEY)");
		const results = await d1.batch([
			d1.prepare("INSERT INTO t DEFAULT VALUES"),
			d1.prepare("SELECT 1 AS one"),
		]);
		expect(results).toHaveLength(2);
	});

	it("dump returns an empty ArrayBuffer", async () => {
		const buf = await makeD1().dump();
		expect(buf.byteLength).toBe(0);
	});

	it("maps undefined bind values to null", async () => {
		const d1 = makeD1("CREATE TABLE t (v TEXT)");
		await d1.prepare("INSERT INTO t (v) VALUES (?)").bind(undefined).run();
		const row = await d1.prepare("SELECT v FROM t").first<{ v: string | null }>();
		expect(row?.v).toBeNull();
	});

	it("accepts initial SQL", async () => {
		const d1 = makeD1("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);");
		const row = await d1.prepare("SELECT id FROM t").first<{ id: number }>();
		expect(row?.id).toBe(1);
	});
});

import { describe, expect, it } from "vitest";

import { Binding, Db, makeDb } from "./index.ts";
import { makeD1 } from "./testing.ts";

describe("makeDb", () => {
	it("returns a drizzle client bound to the D1", () => {
		const db = makeDb(makeD1("CREATE TABLE t (id INTEGER);"));
		expect(db).toBeDefined();
		expect(typeof db.select).toBe("function");
	});
});

describe("service tags", () => {
	it("Binding and Db exist", () => {
		expect(Binding).toBeDefined();
		expect(Db).toBeDefined();
	});
});

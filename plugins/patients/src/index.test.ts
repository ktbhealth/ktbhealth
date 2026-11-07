import { beforeAll, describe, expect, it } from "vitest";

import { makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import type { Plugin } from "@ktb/kernel";
import { createPatient, listPatients, plugin } from "./index.ts";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, created_at INTEGER);
`;

describe("patients repo", () => {
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("creates and lists scoped by owner", async () => {
		await createPatient(db, "u1", "Ana");
		await createPatient(db, "u1", "Bia");
		const rows = await listPatients(db, "u1");
		expect(rows.map((r) => r.name)).toEqual(["Ana", "Bia"]);
	});

	it("scopes to owner only", async () => {
		expect(await listPatients(db, "u2")).toEqual([]);
	});

	it("returns the created row", async () => {
		const p = await createPatient(db, "u1", "Cid");
		expect(p?.name).toBe("Cid");
		expect(p?.ownerId).toBe("u1");
	});

	it("returns null when insert yields no row", async () => {
		const stub = {
			insert: () => ({ values: () => ({ returning: async () => [] }) }),
		} as unknown as typeof db;
		expect(await createPatient(stub, "u1", "X")).toBeNull();
	});
});

describe("plugin", () => {
	it("has id + tables", () => {
		expect(plugin.id).toBe("patients");
		expect(plugin.tables?.patients).toBeDefined();
	});

	it("has no standalone routes", () => {
		expect((plugin as Plugin).routes).toBeUndefined();
	});
});

import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { describe, expect, it } from "vitest";

import { makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { account, session, user, verification } from "./schema.ts";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL REFERENCES "user"(id));
CREATE TABLE account (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES "user"(id), access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER);
`;

describe("auth-better schema", () => {
	it("exposes table config and resolves foreign keys for all auth tables", () => {
		for (const t of [user, session, account, verification]) {
			const cfg = getTableConfig(t);
			expect(cfg.columns.length).toBeGreaterThan(0);
			expect(cfg.name).toBeTruthy();
			for (const fk of cfg.foreignKeys) {
				expect(fk.reference().foreignColumns.length).toBeGreaterThan(0);
			}
		}
	});

	it("fires $onUpdate on session, account and verification", async () => {
		const db = makeDb(makeD1(DDL));
		await db.insert(user).values({
			id: "u1",
			name: "Ana",
			email: "a@x.com",
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});
		await db.insert(session).values({
			id: "s1",
			token: "tok",
			expiresAt: new Date(Date.now() + 10000),
			createdAt: new Date(0),
			updatedAt: new Date(0),
			userId: "u1",
		});
		await db.insert(account).values({
			id: "a1",
			accountId: "acc",
			providerId: "credential",
			userId: "u1",
			password: "hash",
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});
		await db.insert(verification).values({
			id: "v1",
			identifier: "a@x.com",
			value: "123",
			expiresAt: new Date(Date.now() + 10000),
		});
		await db.update(session).set({ token: "tok2" }).where(eq(session.id, "s1"));
		await db.update(account).set({ scope: "s" }).where(eq(account.id, "a1"));
		await db.update(verification).set({ value: "456" }).where(eq(verification.id, "v1"));
		const s = await db.select().from(session);
		const a = await db.select().from(account);
		const v = await db.select().from(verification);
		expect(s[0]?.token).toBe("tok2");
		expect(a[0]?.scope).toBe("s");
		expect(v[0]?.value).toBe("456");
	});

	it("user $onUpdate fires on drizzle update", async () => {
		const db = makeDb(makeD1(DDL));
		await db.insert(user).values({
			id: "u1",
			name: "Ana",
			email: "a@x.com",
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});
		await db.update(user).set({ name: "Ana B" }).where(eq(user.id, "u1"));
		const rows = await db.select().from(user);
		expect(rows[0]?.name).toBe("Ana B");
		expect(rows[0]?.updatedAt.getTime()).toBeGreaterThan(0);
	});
});

import { eq } from "drizzle-orm";

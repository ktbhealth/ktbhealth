import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import type { Plugin } from "@ktb/kernel";
import { Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { UserCogIcon } from "lucide-react";

import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";

import {
	listAllUsers,
	Users,
	UsersLive,
	usersPanelPlugin,
	usersServicesPlugin,
	plugins,
} from "./index.ts";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Admin', 'admin@x.com', 1, NULL, 1000, 1000);
INSERT INTO "user" VALUES ('u2', 'Doc', 'doc@x.com', 0, NULL, 2000, 2000);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER);
INSERT INTO patients (owner_id, name, created_at) VALUES ('u2', 'Ana', 0), ('u2', 'Bia', 0);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, status TEXT);
INSERT INTO consultations (user_id, status) VALUES ('u2', 'done'), ('u1', 'live');
`;

describe("users repo", () => {
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("listAllUsers returns users newest-first with aggregate counts", async () => {
		const rows = await listAllUsers(db);
		expect(rows.map((r) => r.id)).toEqual(["u2", "u1"]);
		const doc = rows.find((r) => r.id === "u2")!;
		expect(doc.patientCount).toBe(2);
		expect(doc.consultationCount).toBe(1);
		const admin = rows.find((r) => r.id === "u1")!;
		expect(admin.patientCount).toBe(0);
		expect(admin.consultationCount).toBe(1);
		expect(admin.emailVerified).toBe(true);
		expect(doc.emailVerified).toBe(false);
	});
});

describe("UsersLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Users, never>;

	beforeAll(() => {
		const db = makeDb(makeD1(DDL));
		const deps = Layer.merge(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		runtime = ManagedRuntime.make(UsersLive.pipe(Layer.provide(deps)));
	});

	afterAll(() => runtime.dispose());

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Users>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const call = <A, E>(f: (p: Users["Service"]) => Effect.Effect<A, E>) => Effect.flatMap(Users, f);

	it("adminList returns all users with isAdmin resolved by the gate", async () => {
		const rows = await asUser(
			"u1",
			call((p) => p.adminList()),
			"admin@x.com",
		);
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.email === "admin@x.com")?.isAdmin).toBe(true);
		expect(rows.find((r) => r.email === "doc@x.com")?.isAdmin).toBe(false);
	});

	it("adminList fails Forbidden for non-admin email and null principal", async () => {
		await expect(
			asUser(
				"u2",
				call((p) => p.adminList()),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
		await expect(
			asUser(
				null,
				call((p) => p.adminList()),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});
});

describe("plugins", () => {
	it("declares services and panel as single-concern plugins", () => {
		expect(usersServicesPlugin.id).toBe("users.services");
		expect(usersServicesPlugin.requiredDeps).toEqual(["platform.admin"]);
		expect(usersServicesPlugin.services).toBe(UsersLive);
		expect(usersPanelPlugin.id).toBe("users.panel");
		expect(usersPanelPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(usersPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/users", label: "Users", icon: UserCogIcon, group: "Access" },
		]);
	});

	it("contributes no routes, tables or top-nav", () => {
		expect((usersServicesPlugin as Plugin).routes).toBeUndefined();
		expect((usersServicesPlugin as Plugin).tables).toBeUndefined();
		expect((usersPanelPlugin as Plugin).routes).toBeUndefined();
		expect((usersPanelPlugin as Plugin).nav).toBeUndefined();
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["users.services", "users.panel"]);
	});
});

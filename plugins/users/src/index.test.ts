import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Query } from "@effect-server-utils/cqrs";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Forbidden, Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { UserCogIcon } from "lucide-react";

import { UsersQueries } from "./api.ts";

import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";

import {
	listAllUsers,
	Users,
	UsersLive,
	UsersQueriesLive,
	usersPanelPlugin,
	usersServicesPlugin,
	plugins,
} from "./index.ts";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cpf TEXT UNIQUE);
INSERT INTO "user" VALUES ('u1', 'Admin', 'admin@x.com', 1, NULL, 1000, 1000, NULL);
INSERT INTO "user" VALUES ('u2', 'Doc', 'doc@x.com', 0, NULL, 2000, 2000, NULL);
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

	it("counts zero for a user with no patients and no consultations", async () => {
		const empty = makeDb(
			makeD1(`
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cpf TEXT UNIQUE);
INSERT INTO "user" VALUES ('u9', 'New', 'new@x.com', 0, NULL, 3000, 3000, NULL);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, status TEXT);
`),
		);
		const [row] = await listAllUsers(empty);
		expect(row).toMatchObject({ id: "u9", patientCount: 0, consultationCount: 0 });
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
		expect(usersServicesPlugin.services).toBeDefined();
		expect(usersPanelPlugin.id).toBe("users.panel");
		expect(usersPanelPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(usersPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/users", label: "Users", icon: UserCogIcon, group: "Access" },
		]);
	});

	describe("panel page loader", () => {
		const loader = usersPanelPlugin.panel!.pages![0]!.loader as () => Effect.Effect<
			unknown,
			never,
			Users
		>;
		const withUsers = (adminList: Users["Service"]["adminList"]) =>
			Effect.runPromise(
				loader().pipe(Effect.provideService(Users, { adminList } as unknown as Users["Service"])),
			);

		it("returns the user listing for admins", async () => {
			const rows = [{ id: "u1" }];
			expect(await withUsers(() => Effect.succeed(rows as never))).toEqual(rows);
		});

		it("collapses Forbidden to an empty table", async () => {
			expect(await withUsers(() => Effect.fail(new Forbidden({ path: "platform.admin" })))).toEqual(
				[],
			);
		});
	});

	it("contributes no routes, tables or top-nav", () => {
		expect("routes" in usersServicesPlugin).toBe(false);
		expect("tables" in usersServicesPlugin).toBe(false);
		expect("routes" in usersPanelPlugin).toBe(false);
		expect("landingNav" in usersPanelPlugin).toBe(false);
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["users.services", "users.panel"]);
	});
});

describe("UsersQueriesLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<never, never>;

	beforeAll(() => {
		runtime = ManagedRuntime.make(
			UsersQueriesLive.pipe(Layer.provideMerge(Layer.succeed(Db, makeDb(makeD1(DDL))))),
		) as unknown as ManagedRuntime.ManagedRuntime<never, never>;
	});

	afterAll(() => runtime.dispose());

	const get = (id: string) =>
		runtime.runPromise(
			Effect.gen(function* () {
				const queries = yield* Query.dispatcher(UsersQueries);
				return yield* queries["users.get"]({ id });
			}).pipe(Effect.scoped) as never,
		);

	it("users.get returns the raw user row", async () => {
		await expect(get("u2")).resolves.toEqual({ id: "u2", email: "doc@x.com", name: "Doc" });
	});

	it("users.get returns null for an unknown id", async () => {
		await expect(get("nobody")).resolves.toBeNull();
	});
});

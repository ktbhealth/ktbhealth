import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Db, makeDb, type SqlDatabase, type SqlStatement } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import {
	CUSTOM_PAGES_TEST_DDL,
	CustomPages,
	CustomPagesLive,
	DuplicatePagePath,
	InvalidPagePath,
	PageNotFound,
	normalizePagePath,
	type CustomPageInput,
} from "./service.ts";

describe("normalizePagePath", () => {
	it("accepts and canonicalizes valid paths", () => {
		expect(normalizePagePath("/about")).toBe("/about");
		expect(normalizePagePath("  /about/us  ")).toBe("/about/us");
		expect(normalizePagePath("/about/")).toBe("/about");
		expect(normalizePagePath("/about//")).toBe("/about");
		expect(normalizePagePath("/")).toBe("/");
		expect(normalizePagePath("/a-b_c.d~e")).toBe("/a-b_c.d~e");
	});

	it("rejects invalid paths", () => {
		for (const bad of [
			"",
			"   ",
			"about",
			"https://x.com/a",
			"/has space",
			"/quest?ion",
			"/hash#tag",
			"/star*",
			"/platform",
			"/platform/x",
			"/platform/",
			`/${"a".repeat(200)}`,
		]) {
			expect(normalizePagePath(bad)).toBeNull();
		}
	});
});

describe("CustomPagesLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<CustomPages, never>;

	beforeAll(() => {
		const db = makeDb(makeD1(CUSTOM_PAGES_TEST_DDL));
		const deps = Layer.merge(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		runtime = ManagedRuntime.make(CustomPagesLive.pipe(Layer.provide(deps)));
	});

	afterAll(() => runtime.dispose());

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, CustomPages>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const call = <A, E>(f: (p: CustomPages["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(CustomPages, f);

	const admin = <A, E>(f: (p: CustomPages["Service"]) => Effect.Effect<A, E>) =>
		asUser("admin-1", call(f), "admin@x.com");

	const input = (over: Partial<CustomPageInput> = {}): CustomPageInput => ({
		path: "/about",
		title: "About",
		content: "# Hello",
		...over,
	});

	it("adminCreate inserts a draft with defaults and returns the row", async () => {
		const row = await admin((p) => p.adminCreate(input()));
		expect(row).not.toBeNull();
		expect(row!.path).toBe("/about");
		expect(row!.published).toBe(false);
		expect(row!.showInNav).toBe(false);
		expect(row!.sortOrder).toBe(0);
	});

	it("adminCreate honors explicit flags and normalized paths", async () => {
		const row = await admin((p) =>
			p.adminCreate(
				input({
					path: "  /team/  ",
					title: "Team",
					published: true,
					showInNav: true,
					sortOrder: 2,
				}),
			),
		);
		expect(row!.path).toBe("/team");
		expect(row!.published).toBe(true);
		expect(row!.showInNav).toBe(true);
		expect(row!.sortOrder).toBe(2);
	});

	it("adminCreate rejects invalid and duplicate paths", async () => {
		await expect(admin((p) => p.adminCreate(input({ path: "nope" })))).rejects.toBeInstanceOf(
			InvalidPagePath,
		);
		await expect(
			admin((p) => p.adminCreate(input({ path: "/platform/x" }))),
		).rejects.toBeInstanceOf(InvalidPagePath);
		await expect(admin((p) => p.adminCreate(input({ path: "/about" })))).rejects.toBeInstanceOf(
			DuplicatePagePath,
		);
	});

	it("adminList returns every page ordered by sortOrder then path", async () => {
		await admin((p) => p.adminCreate(input({ path: "/aaa", title: "A", sortOrder: 1 })));
		await admin((p) => p.adminCreate(input({ path: "/zzz", title: "Z", sortOrder: 0 })));
		const rows = await admin((p) => p.adminList());
		// sortOrder asc, then path asc: /about(0), /zzz(0), /aaa(1), /team(2).
		expect(rows.map((r) => r.path)).toEqual(["/about", "/zzz", "/aaa", "/team"]);
	});

	it("adminUpdate rewrites fields, bumps updatedAt and keeps the id", async () => {
		const created = await admin((p) => p.adminCreate(input({ path: "/edit-me" })));
		const updated = await admin((p) =>
			p.adminUpdate(created!.id, {
				path: "/renamed/",
				title: "Renamed",
				content: "new body",
				published: true,
				showInNav: true,
				sortOrder: 5,
			}),
		);
		expect(updated.id).toBe(created!.id);
		expect(updated.path).toBe("/renamed");
		expect(updated.title).toBe("Renamed");
		expect(updated.content).toBe("new body");
		expect(updated.published).toBe(true);
		expect(updated.showInNav).toBe(true);
		expect(updated.sortOrder).toBe(5);
	});

	it("adminUpdate rejects invalid paths, clashes and missing rows", async () => {
		const target = await admin((p) => p.adminCreate(input({ path: "/upd-target" })));
		await expect(
			admin((p) => p.adminUpdate(target!.id, input({ path: "bad path" }))),
		).rejects.toBeInstanceOf(InvalidPagePath);
		// /about exists from the first test — updating /upd-target onto it clashes.
		await expect(
			admin((p) => p.adminUpdate(target!.id, input({ path: "/about" }))),
		).rejects.toBeInstanceOf(DuplicatePagePath);
		// Updating a row onto its OWN current path is not a clash.
		const same = await admin((p) =>
			p.adminUpdate(target!.id, input({ path: "/upd-target", title: "Still here" })),
		);
		expect(same.path).toBe("/upd-target");
		await expect(
			admin((p) => p.adminUpdate(9999, input({ path: "/ghost" }))),
		).rejects.toBeInstanceOf(PageNotFound);
	});

	it("adminRemove deletes and reports missing rows", async () => {
		const row = await admin((p) => p.adminCreate(input({ path: "/doomed" })));
		await admin((p) => p.adminRemove(row!.id));
		await expect(admin((p) => p.adminRemove(row!.id))).rejects.toBeInstanceOf(PageNotFound);
	});

	it("admin methods are Forbidden for non-admins and anonymous callers", async () => {
		await expect(
			asUser(
				"u1",
				call((p) => p.adminList()),
				"doc@x.com",
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
		await expect(
			asUser(
				null,
				call((p) => p.adminList()),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
		await expect(
			asUser(
				"u1",
				call((p) => p.adminCreate(input({ path: "/nope" }))),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				"u1",
				call((p) => p.adminUpdate(1, input())),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				"u1",
				call((p) => p.adminRemove(1)),
				"doc@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("publishedByPath resolves published rows only, tolerating trailing slashes", async () => {
		await admin((p) => p.adminCreate(input({ path: "/pub", published: true, title: "Pub" })));
		await admin((p) => p.adminCreate(input({ path: "/draft", title: "Draft" })));
		const found = await asUser(
			null,
			call((p) => p.publishedByPath("/pub/")),
		);
		expect(found?.title).toBe("Pub");
		expect(
			await asUser(
				null,
				call((p) => p.publishedByPath("/draft")),
			),
		).toBeNull();
		expect(
			await asUser(
				null,
				call((p) => p.publishedByPath("/missing")),
			),
		).toBeNull();
		// Works without any principal — public read.
		const publicRow = await asUser(
			null,
			call((p) => p.publishedByPath("  /pub  ")),
		);
		expect(publicRow?.path).toBe("/pub");
		// Single-character request paths skip trailing-slash stripping.
		expect(
			await asUser(
				null,
				call((p) => p.publishedByPath("/")),
			),
		).toBeNull();
	});

	it("adminCreate resolves null when the insert returning is empty", async () => {
		// A SqlDatabase whose statements always yield zero rows: the
		// duplicate pre-check passes and the INSERT ... RETURNING comes
		// back empty, so adminCreate's `rows[0] ?? null` arm fires.
		const emptyStatement: SqlStatement = {
			bind: () => emptyStatement,
			first: async <T = unknown>() => null as T | null,
			run: async () => ({ success: true, results: [], meta: {} }),
			all: async <T = unknown>() => ({ success: true, results: [] as T[], meta: {} }),
			raw: async <T = unknown[]>() => [] as unknown as T[],
		};
		const emptySql: SqlDatabase = {
			prepare: () => emptyStatement,
			dump: async () => new ArrayBuffer(0),
			batch: async () => [],
			exec: async () => ({ count: 0, duration: 0 }),
		};
		const deps = Layer.merge(
			Layer.succeed(Db, makeDb(emptySql)),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		const rt = ManagedRuntime.make(CustomPagesLive.pipe(Layer.provide(deps)));
		try {
			const row = await rt.runPromise(
				Effect.gen(function* () {
					const pages = yield* CustomPages;
					return yield* pages.adminCreate(input());
				}).pipe(
					Effect.provideService(Principal, {
						userId: "admin-1",
						email: "admin@x.com",
					}),
				),
			);
			expect(row).toBeNull();
		} finally {
			await rt.dispose();
		}
	});

	it("navList returns published+showInNav rows ordered by sortOrder then title", async () => {
		await admin((p) =>
			p.adminCreate(
				input({
					path: "/nav-b",
					title: "Beta",
					published: true,
					showInNav: true,
					sortOrder: 1,
				}),
			),
		);
		await admin((p) =>
			p.adminCreate(
				input({
					path: "/nav-a",
					title: "Alpha",
					published: true,
					showInNav: true,
					sortOrder: 1,
				}),
			),
		);
		// Published but not flagged, and flagged but unpublished — excluded.
		await admin((p) =>
			p.adminCreate(input({ path: "/nav-off", published: true, showInNav: false })),
		);
		await admin((p) =>
			p.adminCreate(input({ path: "/nav-draft", published: false, showInNav: true })),
		);
		const rows = await asUser(
			null,
			call((p) => p.navList()),
		);
		const paths = rows.map((r) => r.path);
		expect(paths).toContain("/nav-a");
		expect(paths).toContain("/nav-b");
		expect(paths).toContain("/team"); // published + showInNav from earlier test
		expect(paths).not.toContain("/nav-off");
		expect(paths).not.toContain("/nav-draft");
		// sortOrder 1 rows come before /team (sortOrder 2); ties by title.
		expect(paths.indexOf("/nav-a")).toBeLessThan(paths.indexOf("/nav-b"));
		expect(paths.indexOf("/nav-b")).toBeLessThan(paths.indexOf("/team"));
	});
});

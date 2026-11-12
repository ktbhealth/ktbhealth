import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import {
	makePlatformAdminGate,
	parsePlatformAdminEmails,
	PlatformAdmin,
	platformAdminPlugin,
} from "@ktb/platform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import {
	pagesChromePlugin,
	pagesPanelPlugin,
	pagesRenderPlugin,
	pagesServicesPlugin,
	pagesTablesPlugin,
	plugins,
} from "./index.ts";
import { customPage } from "./schema.ts";
import { CUSTOM_PAGES_TEST_DDL, CustomPagesLive } from "./service.ts";

describe("pages plugins", () => {
	it("exposes the five single-concern plugins", () => {
		expect(plugins.map((p) => p.id)).toEqual([
			"pages.tables",
			"pages.services",
			"pages.chrome",
			"pages.render",
			"pages.panel",
		]);
		expect(pagesTablesPlugin.tables?.customPage).toBeDefined();
		expect(pagesServicesPlugin.services).toBeDefined();
		expect(pagesServicesPlugin.requiredDeps).toEqual([platformAdminPlugin.id]);
	});

	it("declares the console sidebar entry and the app nav component", () => {
		const chrome = pagesChromePlugin.chrome ?? [];
		expect(chrome).toHaveLength(2);
		const sidebar = chrome.find((c) => c.id === "pages.sidebar");
		expect(sidebar?.region).toBe("console.sidebar");
		expect(sidebar?.content.kind).toBe("sidebarItem");
		const nav = chrome.find((c) => c.id === "pages.nav");
		expect(nav?.region).toBe("app.header.nav");
		expect(nav?.content.kind).toBe("component");
	});

	it("declares the wildcard app page and the admin console page", () => {
		const page = pagesRenderPlugin.pages?.[0];
		expect(page?.path).toBe("/*");
		expect(page?.context).toBe("app");
		expect(page?.guard).toBeTypeOf("function");
		expect(page?.loader).toBeTypeOf("function");
		const admin = pagesPanelPlugin.panel?.pages?.[0];
		expect(admin?.path).toBe("/platform/pages");
		expect(admin?.guard).toBeTypeOf("function");
		expect(admin?.loader).toBeTypeOf("function");
	});
});

describe("pages page effects", () => {
	let runtime: ManagedRuntime.ManagedRuntime<unknown, never>;

	const asPrincipal = <A, E>(
		principal: { userId: string; email?: string } | null,
		effect: Effect.Effect<A, E, unknown>,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, principal) as Effect.Effect<A, E, never>,
		);

	beforeAll(async () => {
		const db = makeDb(makeD1(CUSTOM_PAGES_TEST_DDL));
		const deps = Layer.merge(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		// Merge `deps` into the runtime too: the admin page guard yields
		// PlatformAdmin directly, not just through CustomPages.
		runtime = ManagedRuntime.make(
			Layer.mergeAll(CustomPagesLive.pipe(Layer.provide(deps)), deps) as Layer.Layer<
				unknown,
				never,
				never
			>,
		);
		const now = new Date();
		await db.insert(customPage).values([
			{
				path: "/pub",
				title: "Pub",
				content: "published body",
				published: true,
				showInNav: true,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			},
			{
				path: "/draft",
				title: "Draft",
				content: "draft body",
				published: false,
				showInNav: false,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			},
		]);
	});

	afterAll(() => runtime.dispose());

	it("wildcard guard admits published paths and denies the rest", async () => {
		const guard = pagesRenderPlugin.pages![0]!.guard!;
		await expect(asPrincipal(null, guard("/pub"))).resolves.toBe(true);
		await expect(asPrincipal(null, guard("/draft"))).resolves.toBe(false);
		await expect(asPrincipal(null, guard("/missing"))).resolves.toBe(false);
	});

	it("wildcard loader returns the published row for the request path", async () => {
		const loader = pagesRenderPlugin.pages![0]!.loader!;
		const row = (await asPrincipal(null, loader("/pub/"))) as { title?: string } | null;
		expect(row?.title).toBe("Pub");
		await expect(asPrincipal(null, loader("/draft"))).resolves.toBeNull();
	});

	it("admin page guard allows admins and denies everyone else", async () => {
		const guard = pagesPanelPlugin.panel!.pages![0]!.guard!;
		await expect(
			asPrincipal({ userId: "a1", email: "admin@x.com" }, guard("/platform/pages")),
		).resolves.toBe(true);
		await expect(
			asPrincipal({ userId: "u1", email: "doc@x.com" }, guard("/platform/pages")),
		).resolves.toBe(false);
		await expect(asPrincipal(null, guard("/platform/pages"))).resolves.toBe(false);
	});

	it("admin page loader lists rows for admins and empties for others", async () => {
		const loader = pagesPanelPlugin.panel!.pages![0]!.loader!;
		const rows = (await asPrincipal(
			{ userId: "a1", email: "admin@x.com" },
			loader("/platform/pages"),
		)) as readonly { path: string }[];
		expect(rows.map((r) => r.path)).toEqual(["/draft", "/pub"]);
		const denied = (await asPrincipal(
			{ userId: "u1", email: "doc@x.com" },
			loader("/platform/pages"),
		)) as readonly unknown[];
		expect(denied).toEqual([]);
	});
});

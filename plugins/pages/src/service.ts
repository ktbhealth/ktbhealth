import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { and, asc, eq, ne } from "drizzle-orm";

import { Forbidden } from "@ktb/authz";
import { Db } from "@ktb/db";
import { PlatformAdmin } from "@ktb/platform";

import { customPage, type CustomPage } from "./schema.ts";

export type { CustomPage } from "./schema.ts";

/**
 * Custom pages domain service (T-083): DB-backed pages rendered through
 * the generic `pages` contribution — one "/*" wildcard descriptor whose
 * guard/loader call `publishedByPath` with the request path. Admin
 * methods re-check the `PlatformAdmin` gate inside the service (defense
 * in depth — the /platform layout and the server fns gate too); public
 * reads (`publishedByPath`, `navList`) need no principal so anonymous
 * visitors can render published pages.
 */

/** Page path rejected by `normalizePagePath` — surfaced to admin fns as
 * a handled failure (they translate it to `null`, like `Forbidden`). */
export class InvalidPagePath extends Data.TaggedError("InvalidPagePath")<{
	readonly path: string;
}> {}

/** `path` already taken by another page — unique index backstop plus a
 * friendly pre-check so the admin UI gets a handled failure. */
export class DuplicatePagePath extends Data.TaggedError("DuplicatePagePath")<{
	readonly path: string;
}> {}

/** `adminUpdate`/`adminRemove` targeted a missing row. */
export class PageNotFound extends Data.TaggedError("PageNotFound")<{
	readonly id: number;
}> {}

export type CustomPageError = Forbidden | InvalidPagePath | DuplicatePagePath | PageNotFound;

/** Admin-facing write payload; booleans/order default when absent. */
export interface CustomPageInput {
	readonly path: string;
	readonly title: string;
	readonly content: string;
	readonly published?: boolean;
	readonly showInNav?: boolean;
	readonly sortOrder?: number;
}

const PATH_MAX = 200;

/**
 * Normalize + validate an admin-supplied page path. Returns the
 * canonical path (leading "/", no trailing slash except root) or null
 * when invalid. Rejected: empty/non-"/" paths, whitespace, URL
 * sigils (`?`, `#`, `*`), overlong paths, and the /platform console
 * namespace — console paths belong to `panel.pages`, an app-context
 * page claiming one is a contract violation the host would ignore.
 */
export const normalizePagePath = (raw: string): string | null => {
	const trimmed = raw.trim();
	if (trimmed.length === 0 || trimmed.length > PATH_MAX) return null;
	if (!trimmed.startsWith("/")) return null;
	if (/[\s?#*]/.test(trimmed)) return null;
	const canonical = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
	if (canonical === "/platform" || canonical.startsWith("/platform/")) return null;
	return canonical;
};

/** Same normalization for request paths arriving at the wildcard
 * descriptor — already-URL-decoded by the router; trailing slashes are
 * ignored so "/about/" resolves the "/about" row. */
const normalizeRequestPath = (path: string): string => {
	const trimmed = path.trim();
	return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
};

export class CustomPages extends Context.Service<
	CustomPages,
	{
		/** Every page, admin view — path order. */
		readonly adminList: () => Effect.Effect<readonly CustomPage[], Forbidden>;
		/** Insert a page; `DuplicatePagePath` when the path is taken. */
		readonly adminCreate: (
			input: CustomPageInput,
		) => Effect.Effect<CustomPage | null, CustomPageError>;
		/** Update a page by id; `PageNotFound` when missing. */
		readonly adminUpdate: (
			id: number,
			input: CustomPageInput,
		) => Effect.Effect<CustomPage, CustomPageError>;
		/** Delete a page by id; `PageNotFound` when missing. */
		readonly adminRemove: (id: number) => Effect.Effect<void, CustomPageError>;
		/** The published page at `path`, or null — public read used by
		 * the wildcard page's guard/loader. */
		readonly publishedByPath: (path: string) => Effect.Effect<CustomPage | null>;
		/** Published pages flagged for nav, ordered for display — public
		 * read used by the app-header chrome component. */
		readonly navList: () => Effect.Effect<readonly CustomPage[]>;
	}
>()("@ktb/pages/CustomPages") {}

export const CustomPagesLive = Layer.effect(
	CustomPages,
	Effect.gen(function* () {
		const db = yield* Db;
		const platformAdmin = yield* PlatformAdmin;

		const requireAdmin = platformAdmin.requireAdmin();

		const byId = (id: number) => eq(customPage.id, id);
		const byPath = (path: string) => eq(customPage.path, path);

		return CustomPages.of({
			adminList: Effect.fn("CustomPages.adminList")(function* () {
				yield* requireAdmin;
				return yield* Effect.promise(() =>
					db.select().from(customPage).orderBy(asc(customPage.sortOrder), asc(customPage.path)),
				);
			}),
			adminCreate: Effect.fn("CustomPages.adminCreate")(function* (input: CustomPageInput) {
				yield* requireAdmin;
				const path = normalizePagePath(input.path);
				if (path === null) return yield* new InvalidPagePath({ path: input.path });
				const existing = yield* Effect.promise(() =>
					db.select({ id: customPage.id }).from(customPage).where(byPath(path)).limit(1),
				);
				if (existing.length > 0) return yield* new DuplicatePagePath({ path });
				const rows = yield* Effect.promise(() =>
					db
						.insert(customPage)
						.values({
							path,
							title: input.title,
							content: input.content,
							published: input.published ?? false,
							showInNav: input.showInNav ?? false,
							sortOrder: input.sortOrder ?? 0,
						})
						.returning(),
				);
				return rows[0] ?? null;
			}),
			adminUpdate: Effect.fn("CustomPages.adminUpdate")(function* (
				id: number,
				input: CustomPageInput,
			) {
				yield* requireAdmin;
				const path = normalizePagePath(input.path);
				if (path === null) return yield* new InvalidPagePath({ path: input.path });
				const clash = yield* Effect.promise(() =>
					db
						.select({ id: customPage.id })
						.from(customPage)
						.where(and(byPath(path), ne(customPage.id, id)))
						.limit(1),
				);
				if (clash.length > 0) return yield* new DuplicatePagePath({ path });
				const rows = yield* Effect.promise(() =>
					db
						.update(customPage)
						.set({
							path,
							title: input.title,
							content: input.content,
							published: input.published ?? false,
							showInNav: input.showInNav ?? false,
							sortOrder: input.sortOrder ?? 0,
							updatedAt: new Date(),
						})
						.where(byId(id))
						.returning(),
				);
				const row = rows[0];
				if (row === undefined) return yield* new PageNotFound({ id });
				return row;
			}),
			adminRemove: Effect.fn("CustomPages.adminRemove")(function* (id: number) {
				yield* requireAdmin;
				const rows = yield* Effect.promise(() =>
					db.delete(customPage).where(byId(id)).returning({ id: customPage.id }),
				);
				if (rows.length === 0) return yield* new PageNotFound({ id });
			}),
			publishedByPath: Effect.fn("CustomPages.publishedByPath")(function* (path: string) {
				const rows = yield* Effect.promise(() =>
					db
						.select()
						.from(customPage)
						.where(
							and(eq(customPage.path, normalizeRequestPath(path)), eq(customPage.published, true)),
						)
						.limit(1),
				);
				return rows[0] ?? null;
			}),
			navList: Effect.fn("CustomPages.navList")(function* () {
				return yield* Effect.promise(() =>
					db
						.select()
						.from(customPage)
						.where(and(eq(customPage.published, true), eq(customPage.showInNav, true)))
						.orderBy(asc(customPage.sortOrder), asc(customPage.title)),
				);
			}),
		});
	}),
);

/**
 * Test-only DDL mirroring the `custom_pages` migration — re-exported for
 * sibling test files (same convention as `AUDIT_TEST_DDL` in
 * plugins/audit). Never used by production code.
 */
export const CUSTOM_PAGES_TEST_DDL = `
CREATE TABLE custom_pages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	path TEXT NOT NULL,
	title TEXT NOT NULL,
	content TEXT NOT NULL,
	published INTEGER NOT NULL DEFAULT 0,
	show_in_nav INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX custom_pages_path_idx ON custom_pages (path);
CREATE INDEX custom_pages_nav_idx ON custom_pages (published, show_in_nav);
`;

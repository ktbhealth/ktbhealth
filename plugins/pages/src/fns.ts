import { createServerFn } from "@tanstack/react-start";

import * as Effect from "effect/Effect";
import { Schema } from "effect";

import { ensureSessionUser, run, runAs } from "@ktb/server-fns";
import { PlatformAdmin } from "@ktb/platform";
import { PluginStates } from "@ktb/platform/plugin-states";

import { CustomPages, type CustomPage, type CustomPageInput } from "./service.ts";

// Custom pages server functions (T-083): admin CRUD is PlatformAdmin-
// gated (the /platform layout already 404s non-admins; the service
// re-checks inside runAs — defense in depth, same pattern as the
// plugin manager). The public nav listing is session-optional: app
// pages may be anonymous, and published pages are public content.
// Handled domain failures (Forbidden / InvalidPagePath /
// DuplicatePagePath / PageNotFound) collapse to null/false — the same
// "not visible / not saved" contract the other plugin fns use; other
// errors still propagate.

/** Serializable page row — timestamps stay server-side (the admin UI
 * doesn't display them and Date doesn't round-trip cleanly). */
export interface PageWire {
	readonly id: number;
	readonly path: string;
	readonly title: string;
	readonly content: string;
	readonly published: boolean;
	readonly showInNav: boolean;
	readonly sortOrder: number;
}

const toWire = (row: CustomPage): PageWire => ({
	id: row.id,
	path: row.path,
	title: row.title,
	content: row.content,
	published: row.published,
	showInNav: row.showInNav,
	sortOrder: row.sortOrder,
});

/** Run `eff` as the session user after the PlatformAdmin gate. */
const asAdmin = <A, E>(
	user: { readonly id: string; readonly email?: string },
	eff: Effect.Effect<A, E, unknown>,
): Promise<A> =>
	runAs(
		user,
		Effect.gen(function* () {
			const platformAdmin = yield* PlatformAdmin;
			yield* platformAdmin.requireAdmin();
			return yield* eff;
		}),
	);

const PageFields = {
	path: Schema.String,
	title: Schema.String,
	content: Schema.String,
	published: Schema.optionalKey(Schema.Boolean),
	showInNav: Schema.optionalKey(Schema.Boolean),
	sortOrder: Schema.optionalKey(Schema.Number),
};
const PageCreateInput = Schema.Struct(PageFields);
const PageUpdateInput = Schema.Struct({ ...PageFields, id: Schema.Number });
const PageIdInput = Schema.Struct({ id: Schema.Number });

const decodeCreate = Schema.decodeUnknownSync(PageCreateInput);
const decodeUpdate = Schema.decodeUnknownSync(PageUpdateInput);
const decodeId = Schema.decodeUnknownSync(PageIdInput);

const HANDLED_TAGS = ["Forbidden", "InvalidPagePath", "DuplicatePagePath", "PageNotFound"] as const;

/** Create a page; `null` for non-admins and handled domain failures
 * (invalid/duplicate path), same contract as the manager fns. */
export const createPageFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeCreate(input))
	.handler(async ({ data }): Promise<PageWire | null> => {
		const user = await ensureSessionUser();
		return asAdmin(
			user,
			Effect.gen(function* () {
				const pages = yield* CustomPages;
				const row = yield* pages.adminCreate(data as CustomPageInput);
				return row === null ? null : toWire(row);
			}),
		).catch((error: unknown) => {
			if (typeof error === "object" && error !== null && "_tag" in error) {
				if (
					(HANDLED_TAGS as readonly string[]).includes(String((error as { _tag?: unknown })._tag))
				) {
					return null;
				}
			}
			throw error;
		});
	});

/** Update a page by id; `null` for non-admins, missing rows and
 * handled domain failures. */
export const updatePageFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeUpdate(input))
	.handler(async ({ data }): Promise<PageWire | null> => {
		const user = await ensureSessionUser();
		return asAdmin(
			user,
			Effect.gen(function* () {
				const pages = yield* CustomPages;
				const { id, ...input } = data;
				return toWire(yield* pages.adminUpdate(id, input as CustomPageInput));
			}),
		).catch((error: unknown) => {
			if (typeof error === "object" && error !== null && "_tag" in error) {
				if (
					(HANDLED_TAGS as readonly string[]).includes(String((error as { _tag?: unknown })._tag))
				) {
					return null;
				}
			}
			throw error;
		});
	});

/** Delete a page by id; `false` for non-admins and missing rows. */
export const deletePageFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeId(input))
	.handler(async ({ data }): Promise<boolean> => {
		const user = await ensureSessionUser();
		return asAdmin(
			user,
			Effect.gen(function* () {
				const pages = yield* CustomPages;
				yield* pages.adminRemove(data.id);
				return true;
			}),
		).catch((error: unknown) => {
			if (typeof error === "object" && error !== null && "_tag" in error) {
				if (
					(HANDLED_TAGS as readonly string[]).includes(String((error as { _tag?: unknown })._tag))
				) {
					return false;
				}
			}
			throw error;
		});
	});

/** Nav entry for the app-header chrome component — path/title/order
 * only. Public (anonymous visitors see the same nav); returns [] when
 * the owning plugin is disabled so a turned-off plugin can't leak nav
 * links to pages that now 404. */
export interface NavPageWire {
	readonly path: string;
	readonly title: string;
	readonly sortOrder: number;
}

export const navPagesFn = createServerFn({ method: "GET" }).handler(
	async (): Promise<readonly NavPageWire[]> => {
		const enabled = await run(
			Effect.gen(function* () {
				const states = yield* PluginStates;
				return yield* states.isEnabled("pages.render");
			}),
		);
		if (!enabled) return [];
		return run(
			Effect.gen(function* () {
				const pages = yield* CustomPages;
				const rows = yield* pages.navList();
				return rows.map((row) => ({
					path: row.path,
					title: row.title,
					sortOrder: row.sortOrder,
				}));
			}),
		);
	},
);

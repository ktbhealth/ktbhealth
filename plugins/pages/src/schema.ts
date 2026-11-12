import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Custom pages (T-083): admin-authored, DB-stored pages rendered by
 * this plugin through the generic `pages` contribution — one "/*"
 * wildcard descriptor whose guard/loader resolve `path` against this
 * table at request time. `content` is a markdown subset (headings,
 * lists, paragraphs, inline bold/italic/code/links — no raw HTML); the
 * renderer is plugin-side, so the column stays plain text. `published`
 * gates public visibility (drafts 404); `showInNav` + `sortOrder` drive
 * the optional app-header nav listing.
 *
 * Plugin-owned table definition (P-061): aggregated into the drizzle
 * schema by the generated packages/db/src/schema.gen.ts — consumers
 * keep importing it from `@ktb/db/schema` (or `@ktb/pages/schema`).
 */
export const customPage = sqliteTable(
	"custom_pages",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		path: text().notNull(),
		title: text().notNull(),
		content: text().notNull(),
		published: integer({ mode: "boolean" }).notNull().default(false),
		showInNav: integer("show_in_nav", { mode: "boolean" }).notNull().default(false),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		uniqueIndex("custom_pages_path_idx").on(table.path),
		index("custom_pages_nav_idx").on(table.published, table.showInNav),
	],
);

export type CustomPage = typeof customPage.$inferSelect;
export type CustomPageInsert = typeof customPage.$inferInsert;

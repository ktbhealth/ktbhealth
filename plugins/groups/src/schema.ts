import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Generic groups: clinics, orgs, cohorts or any custom grouping. `kind`
 * is free-form; `meta` is an optional JSON payload stored as text.
 *
 * Plugin-owned table definition (P-061): aggregated into the drizzle
 * schema by the generated packages/db/src/schema.gen.ts, so consumers
 * keep importing it from `@ktb/db/schema` (or `@ktb/groups/schema`).
 */
export const groups = sqliteTable("groups", {
	id: integer().primaryKey({ autoIncrement: true }),
	name: text().notNull(),
	slug: text().notNull().unique(),
	kind: text().notNull(),
	meta: text(),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

/**
 * Group membership — polymorphic `memberKind`/`memberId` pair
 * ("user" today, "patient" later). One row per (group, member).
 */
export const groupMembers = sqliteTable(
	"group_members",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		groupId: integer("group_id")
			.notNull()
			.references(() => groups.id, { onDelete: "cascade" }),
		memberKind: text("member_kind").notNull(),
		memberId: text("member_id").notNull(),
		role: text(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		uniqueIndex("group_members_group_member_idx").on(
			table.groupId,
			table.memberKind,
			table.memberId,
		),
	],
);

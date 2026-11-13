import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Relative import on purpose: drizzle-kit loads the composed schema
// through a CJS resolver that cannot follow `@ktb/*` package
// specifiers, and the generated packages/db/src/schema.gen.ts reaches
// plugin sources by relative path anyway — keep the FK targets on the
// same module resolution.
import { user } from "../../../packages/db/src/auth.ts";

/**
 * Doctor profile — one per user. The row marks the account as a doctor
 * and carries the professional data; clinical ownership columns
 * (`patients.owner_id`, `consultations.user_id`) keep pointing at the
 * owning `user.id`, so this table never participates in data scoping.
 * `crm`/`specialty` are descriptive, not verified credentials.
 */
export const doctors = sqliteTable("doctors", {
	id: integer().primaryKey({ autoIncrement: true }),
	userId: text("user_id")
		.notNull()
		.unique()
		.references(() => user.id, { onDelete: "cascade" }),
	displayName: text("display_name").notNull(),
	crm: text(),
	specialty: text(),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export type Doctor = typeof doctors.$inferSelect;

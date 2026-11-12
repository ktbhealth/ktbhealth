import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Plugin-owned table definition (P-061): aggregated into the drizzle
 * schema by the generated packages/db/src/schema.gen.ts, so consumers
 * keep importing it from `@ktb/db/schema` (or `@ktb/notifications/schema`).
 *
 * Per-user console notifications persisted from domain events. `payload`
 * is a JSON string (event-specific extras); `read_at` null = unread.
 */
export const notifications = sqliteTable("notifications", {
	id: integer().primaryKey({ autoIncrement: true }),
	userId: text("user_id").notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	body: text(),
	payload: text(),
	readAt: integer("read_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

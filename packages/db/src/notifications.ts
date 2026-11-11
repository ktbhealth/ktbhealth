import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Per-user console notifications persisted from domain events. `payload`
// is a JSON string (event-specific extras); `read_at` null = unread.
// Host-owned by @ktb/db (not a plugin slice) to break the @ktb/db ↔
// plugin workspace cycle — plugins import this from `@ktb/db/schema`.
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

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
	id: integer().primaryKey({ autoIncrement: true }),
	handle: text().notNull().unique(),
	name: text(),
	isGuest: integer("is_guest", { mode: "boolean" }).notNull().default(true),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

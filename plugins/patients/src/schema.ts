import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const patients = sqliteTable("patients", {
	id: integer().primaryKey({ autoIncrement: true }),
	ownerId: text("owner_id").notNull(),
	name: text().notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

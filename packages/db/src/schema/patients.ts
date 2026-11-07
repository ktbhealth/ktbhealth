import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./users.ts";

export const patients = sqliteTable("patients", {
	id: integer().primaryKey({ autoIncrement: true }),
	ownerId: integer("owner_id")
		.notNull()
		.references(() => users.id),
	name: text().notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

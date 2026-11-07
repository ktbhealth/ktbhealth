import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "@ktb/auth-better/schema";

export const patients = sqliteTable("patients", {
	id: integer().primaryKey({ autoIncrement: true }),
	ownerId: text("owner_id")
		.notNull()
		.references(() => user.id),
	name: text().notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

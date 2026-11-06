import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const consultations = sqliteTable("consultations", {
	id: integer().primaryKey({ autoIncrement: true }),
	/** Transcript-only by design — audio never leaves the browser. */
	transcript: text().notNull(),
	/** Serialized Anamnesis (structured, reviewed/editable). */
	anamnesis: text(),
	/** Which AnamnesisExtractor produced the draft. */
	engine: text(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const consultations = sqliteTable("consultations", {
	id: integer().primaryKey({ autoIncrement: true }),
	/** Transcript-only by design — audio never leaves the browser. */
	transcript: text().notNull(),
	/** Serialized Anamnesis (structured, reviewed/editable). */
	anamnesis: text(),
	/** Which AnamnesisExtractor produced the draft. */
	engine: text(),
	/** Transcription source: browser | bot | dictation | upload. */
	source: text().notNull().default("browser"),
	/** live (still transcribing) | done */
	status: text().notNull().default("done"),
	/** Provider-side bot id (MeetingBotTranscriber source). */
	botId: text("bot_id"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

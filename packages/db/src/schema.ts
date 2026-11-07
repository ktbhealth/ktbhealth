import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
	id: integer().primaryKey({ autoIncrement: true }),
	handle: text().notNull().unique(),
	name: text(),
	isGuest: integer("is_guest", { mode: "boolean" }).notNull().default(true),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const patients = sqliteTable("patients", {
	id: integer().primaryKey({ autoIncrement: true }),
	ownerId: integer("owner_id")
		.notNull()
		.references(() => users.id),
	name: text().notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const consultations = sqliteTable("consultations", {
	id: integer().primaryKey({ autoIncrement: true }),
	userId: integer("user_id").references(() => users.id),
	patientId: integer("patient_id").references(() => patients.id),
	/** Transcript-only by design — audio never leaves the browser. */
	transcript: text().notNull(),
	/** Serialized Anamnesis (structured, reviewed/editable). */
	anamnesis: text(),
	/** Serialized AnamnesisReview (second opinion — decision support). */
	review: text(),
	/** Which AnamnesisExtractor produced the draft. */
	engine: text(),
	/** Transcription source: browser | bot | dictation | upload. */
	source: text().notNull().default("browser"),
	/** live (still transcribing) | done */
	status: text().notNull().default("done"),
	/** Provider-side bot id (MeetingBotTranscriber source). */
	botId: text("bot_id"),
	/** When the doctor declared patient consent (LGPD trail). */
	consentAt: integer("consent_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

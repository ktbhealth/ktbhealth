import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Relative imports on purpose: drizzle-kit loads the composed schema
// through a CJS resolver that cannot follow `@ktb/*` package
// specifiers, and the generated packages/db/src/schema.gen.ts reaches
// plugin sources by relative path anyway — keep the FK targets on the
// same module resolution.
import { groups } from "../../groups/src/schema.ts";
import { patients } from "../../patients/src/schema.ts";

// `tenantId` (P-053): NULL = personal row scoped by `userId`; a
// `groups.id` = tenant-owned row readable/operable by that tenant's
// members. `userId` stays the creator/owner attribution either way.
// Same `sqliteTable` (not `tenantTable`) rationale as the patients
// table — see @ktb/patients/schema. SET NULL keeps the record if the
// clinic group is deleted. The column is declared inline
// (`integer("tenant_id")`, same shape as `@ktb/tenant`'s
// `tenantIdColumn`) because @ktb/tenant depends on @ktb/db — importing
// it here would create a workspace cycle.
//
// Plugin-owned table definition (P-061): aggregated into the drizzle
// schema by the generated packages/db/src/schema.gen.ts — consumers
// keep importing it from `@ktb/db/schema` (or
// `@ktb/consultations/schema`).
export const consultations = sqliteTable(
	"consultations",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		userId: text("user_id"),
		patientId: integer("patient_id").references(() => patients.id),
		tenantId: integer("tenant_id").references(() => groups.id, { onDelete: "set null" }),
		/** Browser-side transcript; the stored audio lives in R2 (audioKey). */
		transcript: text().notNull(),
		/** Serialized Anamnesis (structured, reviewed/editable). */
		anamnesis: text(),
		/** Retained legacy column: second-opinion review was removed. */
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
		/** R2 object key for the stored session audio (P-015). */
		audioKey: text("audio_key"),
		/**
		 * Audio pipeline state: none | stored | queued | processing | done | failed.
		 * "done" means the server transcript finished; LLM cleanup is tracked
		 * separately via correctedTranscript/enhancementEngine.
		 */
		audioStatus: text("audio_status").notNull().default("none"),
		audioContentType: text("audio_content_type"),
		audioSize: integer("audio_size"),
		/** Last pipeline failure reason — surfaced to the doctor, never the audio. */
		audioError: text("audio_error"),
		/** whisper-large-v3-turbo output — the raw ASR evidence. */
		serverTranscript: text("server_transcript"),
		/** LLM-cleaned PT-BR transcript — machine-corrected, NOT physician-approved. */
		correctedTranscript: text("corrected_transcript"),
		/** Which engine produced correctedTranscript (e.g. "anthropic", "workers-ai:..."). */
		enhancementEngine: text("enhancement_engine"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [index("consultations_tenant_id_idx").on(table.tenantId)],
);

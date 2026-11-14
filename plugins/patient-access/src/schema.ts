import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Relative imports on purpose: drizzle-kit loads the composed schema
// through a CJS resolver that cannot follow `@ktb/*` package
// specifiers, and the generated packages/db/src/schema.gen.ts reaches
// plugin sources by relative path anyway — keep the FK targets on the
// same module resolution.
import { user } from "../../../packages/db/src/auth.ts";
import { patients } from "../../patients/src/schema.ts";

/** self = the user is the patient; guardian = acts for the patient
 * (e.g. a parent accessing a child's profile). */
export const PATIENT_ACCESS_RELATIONS = ["self", "guardian"] as const;
export type PatientAccessRelation = (typeof PATIENT_ACCESS_RELATIONS)[number];

/**
 * invited — doctor invite awaiting a matching verified email;
 * pending — awaiting approval by the doctor;
 * active — grants portal access; revoked — access removed.
 */
export const PATIENT_ACCESS_STATUSES = ["invited", "pending", "active", "revoked"] as const;
export type PatientAccessStatus = (typeof PATIENT_ACCESS_STATUSES)[number];

/** How the link was created: doctor invite, or a CPF match on links
 * written before account CPFs were dropped (historical rows only). */
export const PATIENT_ACCESS_SOURCES = ["invite", "cpf"] as const;
export type PatientAccessSource = (typeof PATIENT_ACCESS_SOURCES)[number];

/**
 * Portal access of a user to a patient record. `patients` rows are
 * per-doctor, so one person may hold links to several records; only
 * "active" rows grant access.
 *
 * Invites are keyed by `email` (stored lowercased) with `user_id` NULL
 * until claimed. NULLs are distinct in SQLite, so the (patient, user)
 * unique index only constrains claimed rows.
 */
export const patientAccess = sqliteTable(
	"patient_access",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		patientId: integer("patient_id")
			.notNull()
			.references(() => patients.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		email: text(),
		relation: text().notNull(),
		status: text().notNull(),
		source: text().notNull(),
		/** `user.id` of who invited or approved the link. */
		grantedBy: text("granted_by"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("patient_access_patient_user_idx").on(table.patientId, table.userId),
		// Profile resolution looks up by user; invite claiming by email.
		index("patient_access_user_idx").on(table.userId),
		index("patient_access_email_idx").on(table.email),
	],
);

export type PatientAccess = typeof patientAccess.$inferSelect;

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Relative imports on purpose: drizzle-kit loads the composed schema
// through a CJS resolver that cannot follow `@ktb/*` package
// specifiers, and the generated packages/db/src/schema.gen.ts reaches
// plugin sources by relative path anyway — keep the FK targets on the
// same module resolution.
import { user } from "../../../packages/db/src/auth.ts";
import { doctors } from "../../doctors/src/schema.ts";

/** Delegate roles on a doctor profile. Only "secretary" today. */
export const DOCTOR_ACCESS_ROLES = ["secretary"] as const;
export type DoctorAccessRole = (typeof DOCTOR_ACCESS_ROLES)[number];

/** invited (awaiting a matching verified email) → active → revoked. */
export const DOCTOR_ACCESS_STATUSES = ["invited", "active", "revoked"] as const;
export type DoctorAccessStatus = (typeof DOCTOR_ACCESS_STATUSES)[number];

/**
 * Delegated access to a doctor profile: a user (secretary) acting on
 * behalf of a doctor. The doctor's own access is implicit through
 * `doctors.user_id` — this table only holds delegates.
 *
 * An invite is a row keyed by `email` (stored lowercased) with
 * `user_id` NULL; it is claimed — `user_id` set, status "active" — when
 * a user with that verified email signs in. One row per (doctor, email).
 */
export const doctorAccess = sqliteTable(
	"doctor_access",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		doctorId: integer("doctor_id")
			.notNull()
			.references(() => doctors.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		email: text().notNull(),
		role: text().notNull().default("secretary"),
		status: text().notNull().default("invited"),
		/** `user.id` of who sent the invite (the doctor). */
		invitedBy: text("invited_by"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("doctor_access_doctor_email_idx").on(table.doctorId, table.email),
		// Profile resolution looks up by user; invite claiming by email.
		index("doctor_access_user_idx").on(table.userId),
		index("doctor_access_email_idx").on(table.email),
	],
);

export type DoctorAccess = typeof doctorAccess.$inferSelect;

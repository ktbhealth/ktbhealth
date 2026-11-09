import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// FHIR R4 Patient + RNDS/BR Core extensions; codes and labels live in
// ./record.ts. Everything beyond `name` is nullable so pre-existing
// name-only patients stay valid until the doctor completes the record.
export const patients = sqliteTable("patients", {
	id: integer().primaryKey({ autoIncrement: true }),
	ownerId: text("owner_id").notNull(),
	name: text().notNull(),
	active: integer({ mode: "boolean" }).notNull().default(true),
	socialName: text("social_name"),
	/** FHIR AdministrativeGender. */
	gender: text(),
	/** FHIR date: YYYY | YYYY-MM | YYYY-MM-DD. */
	birthDate: text("birth_date"),
	/** Digits only. */
	cpf: text(),
	/** Digits only. */
	cns: text(),
	passport: text(),
	phone: text(),
	email: text(),
	/** BCP-47 tag. */
	preferredLanguage: text("preferred_language"),
	addressLine: text("address_line"),
	addressNumber: text("address_number"),
	addressComplement: text("address_complement"),
	district: text(),
	city: text(),
	state: text(),
	postalCode: text("postal_code"),
	/** ISO 3166-1 alpha-2. */
	country: text(),
	motherName: text("mother_name"),
	/** HL7 v3 MaritalStatus. */
	maritalStatus: text("marital_status"),
	/** RNDS BRRacaCor. */
	raceColor: text("race_color"),
	/** ISO 3166-1 alpha-2. */
	nationality: text(),
	emergencyContactName: text("emergency_contact_name"),
	emergencyContactRelationship: text("emergency_contact_relationship"),
	emergencyContactPhone: text("emergency_contact_phone"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }),
});

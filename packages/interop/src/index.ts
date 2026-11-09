/**
 * Interoperability export port — the clinical record as plain data, and
 * the contract every standard-specific adapter (`@ktb/interop-fhir`,
 * `@ktb/interop-openehr`) implements. Adapters are pure: same input,
 * same document (ids and timestamps are injected, never read from the
 * environment), so exports are reproducible and testable.
 *
 * The DTOs are structural copies of the patients/consultations rows the
 * host already loads; packages cannot import plugins, so the host maps
 * its rows onto these shapes in the composition root.
 */
import type { Anamnesis } from "@ktb/anamnesis";

/** Patient record — FHIR R4 Patient + RNDS fields, codes as stored (see @ktb/patients/record). */
export interface PatientRecord {
	readonly id: number;
	readonly active: boolean;
	readonly name: string;
	readonly socialName: string | null;
	/** FHIR AdministrativeGender. */
	readonly gender: string | null;
	/** FHIR date: YYYY | YYYY-MM | YYYY-MM-DD. */
	readonly birthDate: string | null;
	/** Digits only. */
	readonly cpf: string | null;
	/** Digits only. */
	readonly cns: string | null;
	readonly passport: string | null;
	readonly phone: string | null;
	readonly email: string | null;
	/** BCP-47 tag. */
	readonly preferredLanguage: string | null;
	readonly addressLine: string | null;
	readonly addressNumber: string | null;
	readonly addressComplement: string | null;
	readonly district: string | null;
	readonly city: string | null;
	/** UF when country is BR, free text otherwise. */
	readonly state: string | null;
	readonly postalCode: string | null;
	/** ISO 3166-1 alpha-2. */
	readonly country: string | null;
	readonly motherName: string | null;
	/** HL7 v3 MaritalStatus code. */
	readonly maritalStatus: string | null;
	/** RNDS BRRacaCor code. */
	readonly raceColor: string | null;
	/** ISO 3166-1 alpha-2. */
	readonly nationality: string | null;
	readonly emergencyContactName: string | null;
	readonly emergencyContactRelationship: string | null;
	readonly emergencyContactPhone: string | null;
	readonly createdAt: Date;
	readonly updatedAt: Date | null;
}

/** One documented consultation of the patient. */
export interface ConsultationRecord {
	readonly id: number;
	readonly createdAt: Date;
	/** Capture channel: browser | bot | dictation | upload. */
	readonly source: string;
	/** live (still transcribing) | done. */
	readonly status: string;
	/** When the physician declared the patient's consent to recording (LGPD). */
	readonly consentAt: Date | null;
	/** Transcript the documentation was drafted from (pt-BR). */
	readonly transcript: string;
	/** Physician-reviewable structured note; null when none was saved. */
	readonly anamnesis: Anamnesis | null;
	/** Which extractor drafted the anamnesis (e.g. "llm", "heuristic"). */
	readonly engine: string | null;
}

/** The documenting physician (the signed-in user that owns the record). */
export interface PractitionerRecord {
	readonly id: string;
	readonly name: string;
	readonly email: string | null;
}

/** Everything one export covers: a patient and their consultations. */
export interface ClinicalRecordExport {
	readonly patient: PatientRecord;
	readonly consultations: readonly ConsultationRecord[];
	readonly practitioner: PractitionerRecord;
	/** Export instant — stamps bundle/composition metadata. */
	readonly exportedAt: Date;
}

/** Injected sources of non-determinism. */
export interface RenderOptions {
	/** Fresh RFC 4122 UUID (defaults to `crypto.randomUUID`). */
	readonly uuid?: () => string;
}

export const EXPORT_FORMATS = ["fhir-r4", "openehr"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const isExportFormat = (value: unknown): value is ExportFormat =>
	typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);

/** A standard-specific serializer of the clinical record. */
export interface RecordExporter {
	readonly format: ExportFormat;
	/** Response media type, e.g. "application/fhir+json". */
	readonly mediaType: string;
	/** Download file suffix, e.g. "fhir-r4.json". */
	readonly fileSuffix: string;
	/** Serialize the record as the standard's JSON document. */
	render(input: ClinicalRecordExport, options?: RenderOptions): string;
}

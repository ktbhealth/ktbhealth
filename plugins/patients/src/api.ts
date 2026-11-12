import * as Schema from "effect/Schema";
import { Command, Event, Query } from "@effect-server-utils/cqrs";
import { Forbidden } from "@ktb/authz";

/** `Forbidden` is a `Data.TaggedError`, not a `Schema` — declare a schema
 * view of it so command failures stay typed end to end. */
const ForbiddenSchema = Schema.declare<Forbidden>((u): u is Forbidden => u instanceof Forbidden);

/** Cross-plugin surface for patients — queries via `Query.dispatcher`,
 * commands via `Command.dispatcher`, events via `EventBus`. */
export const PatientOwnerOf = Query.make("patients.ownerOf", {
	payload: { id: Schema.Number },
	success: Schema.NullOr(
		Schema.Struct({ ownerId: Schema.String, tenantId: Schema.NullOr(Schema.Number) }),
	),
});

export const PatientsQueries = Query.group(PatientOwnerOf);

export const PatientDelete = Command.make("patients.delete", {
	payload: { id: Schema.Number },
	success: Schema.Void,
	failure: ForbiddenSchema,
});

export const PatientsCommands = Command.group(PatientDelete);

/**
 * Owner-facing consultation slice for the patient record page (P-033).
 * Defined here — not in @ktb/consultations — so the patients plugin's
 * own server functions can dispatch it without a plugin→plugin package
 * import; the consultations plugin registers the handlers (it owns the
 * tables and the authz rules).
 */
export const PatientRecordConsultations = Query.make("patients.recordConsultations", {
	payload: { patientId: Schema.Number },
	success: Schema.Array(
		Schema.Struct({
			id: Schema.Number,
			patientId: Schema.Number,
			createdAt: Schema.Date,
			status: Schema.String,
			hasAnamnesis: Schema.Boolean,
			chiefComplaint: Schema.NullOr(Schema.String),
		}),
	),
	failure: ForbiddenSchema,
});

export const PatientRecordConsultationsQueries = Query.group(PatientRecordConsultations);

/**
 * Patient delete with the consultations cascade + audio-key handoff
 * (P-033). The consultations plugin owns the orchestration — it already
 * sequences the consultations row delete, the `patients.delete` command
 * and the authz checks; this command exposes that flow to the patients
 * plugin's server function, which then purges the returned R2 keys.
 */
export const PatientDeleteCascade = Command.make("patients.deleteCascade", {
	payload: { patientId: Schema.Number },
	success: Schema.NullOr(
		Schema.Struct({
			consultations: Schema.Number,
			audioKeys: Schema.Array(Schema.String),
		}),
	),
	failure: ForbiddenSchema,
});

export const PatientCascadeCommands = Command.group(PatientDeleteCascade);

export const PatientCreated = Event.make("patient.created", {
	id: Schema.Number,
	ownerId: Schema.String,
	name: Schema.String,
	/** Owning tenant (`groups.id`) or null for personal rows — optional so
	 * pre-tenancy dispatches/tests stay valid; subscribers treat a missing
	 * value as personal scope. */
	tenantId: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

export const PatientDeleted = Event.make("patient.deleted", {
	id: Schema.Number,
	ownerId: Schema.String,
	/** Owning tenant (`groups.id`) or null for personal rows — see
	 * {@link PatientCreated}. */
	tenantId: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

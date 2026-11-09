import * as Schema from "effect/Schema";
import { Event, Query } from "@effect-server-utils/cqrs";
import { Forbidden } from "@ktb/authz";

/** `Forbidden` is a `Data.TaggedError`, not a `Schema` — declare a schema
 * view of it so query failures stay typed end to end. */
const ForbiddenSchema = Schema.declare<Forbidden>((u): u is Forbidden => u instanceof Forbidden);

/** Cross-plugin surface for consultations — queries via
 * `Query.dispatcher`, events via `EventBus`. */
export const ConsultationsForPatient = Query.make("consultations.forPatient", {
	payload: { patientId: Schema.Number },
	success: Schema.Array(
		Schema.Struct({
			id: Schema.Number,
			status: Schema.String,
			createdAt: Schema.Date,
		}),
	),
});

/** Minimal audio-pipeline projection for the /platform jobs feed —
 * exactly the fields `jobsFromAudioRows` maps (status filtering stays
 * in the jobs plugin). Cross-owner read: the handler enforces the
 * platform-admin gate and fails `Forbidden` otherwise. */
export const ConsultationsAudioJobs = Query.make("consultations.audioJobs", {
	payload: Schema.Struct({}),
	success: Schema.Array(
		Schema.Struct({
			id: Schema.Number,
			audioStatus: Schema.String,
			audioError: Schema.NullOr(Schema.String),
			createdAt: Schema.Date,
			patientName: Schema.NullOr(Schema.String),
		}),
	),
	failure: ForbiddenSchema,
});

export const ConsultationsQueries = Query.group(ConsultationsForPatient, ConsultationsAudioJobs);

export const ConsultationCreated = Event.make("consultation.created", {
	id: Schema.Number,
	userId: Schema.String,
	source: Schema.String,
});

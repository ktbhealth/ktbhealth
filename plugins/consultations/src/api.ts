import * as Schema from "effect/Schema";
import { Event, Query } from "@effect-server-utils/cqrs";

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

export const ConsultationsQueries = Query.group(ConsultationsForPatient);

export const ConsultationCreated = Event.make("consultation.created", {
	id: Schema.Number,
	userId: Schema.String,
	source: Schema.String,
});

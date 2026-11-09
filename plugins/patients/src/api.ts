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
	success: Schema.NullOr(Schema.Struct({ ownerId: Schema.String })),
});

export const PatientsQueries = Query.group(PatientOwnerOf);

export const PatientDelete = Command.make("patients.delete", {
	payload: { id: Schema.Number },
	success: Schema.Void,
	failure: ForbiddenSchema,
});

export const PatientsCommands = Command.group(PatientDelete);

export const PatientCreated = Event.make("patient.created", {
	id: Schema.Number,
	ownerId: Schema.String,
	name: Schema.String,
});

export const PatientDeleted = Event.make("patient.deleted", {
	id: Schema.Number,
	ownerId: Schema.String,
});

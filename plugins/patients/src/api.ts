import * as Schema from "effect/Schema";
import { Query } from "@effect-server-utils/cqrs";

/** Cross-plugin read surface for patients — consumed via `Query.dispatcher`. */
export const PatientOwnerOf = Query.make("patients.ownerOf", {
	payload: { id: Schema.Number },
	success: Schema.NullOr(Schema.Struct({ ownerId: Schema.String })),
});

export const PatientsQueries = Query.group(PatientOwnerOf);

import * as Schema from "effect/Schema";
import { Query } from "@effect-server-utils/cqrs";

/** Cross-plugin surface for groups — dispatch via
 * `Query.dispatcher(GroupsQueries)`. Raw repo reads; authz is the
 * caller's concern (same contract as `patients.ownerOf`). */
export const GroupGet = Query.make("groups.get", {
	payload: { id: Schema.Number },
	success: Schema.NullOr(
		Schema.Struct({
			id: Schema.Number,
			name: Schema.String,
			slug: Schema.String,
			kind: Schema.String,
		}),
	),
});

export const GroupsQueries = Query.group(GroupGet);

import * as Schema from "effect/Schema";
import { Query } from "@effect-server-utils/cqrs";

/** Cross-plugin surface for users — dispatch via
 * `Query.dispatcher(UsersQueries)`. Raw repo reads; authz is the
 * caller's concern (same contract as `patients.ownerOf`). */
export const UserGet = Query.make("users.get", {
	payload: { id: Schema.String },
	success: Schema.NullOr(
		Schema.Struct({
			id: Schema.String,
			email: Schema.String,
			name: Schema.NullOr(Schema.String),
		}),
	),
});

export const UsersQueries = Query.group(UserGet);

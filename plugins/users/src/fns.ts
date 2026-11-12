import { createServerFn } from "@tanstack/react-start";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ensureSessionUser, runAs } from "@ktb/server-fns";

import { Users } from "./index.ts";

// Users admin server functions: the /platform/users console mutates
// through these — every call re-checks the PlatformAdmin gate inside the
// Users service (defense in depth on top of the layout guard).
// `Forbidden` collapses to `{ ok: false }` like the other admin fns.

const SetSuspendedInput = Schema.Struct({
	userId: Schema.NonEmptyString,
	suspended: Schema.Boolean,
});

const decodeSetSuspended = Schema.decodeUnknownSync(SetSuspendedInput);

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false };

/**
 * Suspend or reactivate a user (T-034). Suspension bans sign-in at the
 * Auth port — sessions are revoked and `getSession` returns null until
 * reactivated.
 */
export const setUserSuspendedFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeSetSuspended(input))
	.handler(async ({ data }): Promise<Result<null>> => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const users = yield* Users;
					yield* users.adminSetSuspended(data.userId, data.suspended);
					return { ok: true as const, data: null };
				}),
			).pipe(Effect.catchTag("Forbidden", () => Effect.succeed({ ok: false as const }))),
		);
	});

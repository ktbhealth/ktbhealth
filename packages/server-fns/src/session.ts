import { getRequestHeaders } from "@tanstack/react-start/server";

import { Auth } from "@ktb/auth";
import type { SessionUser } from "@ktb/auth";
import * as Effect from "effect/Effect";

import { run } from "./runtime.ts";

export type { SessionUser };

/**
 * Thrown by `ensureSessionUser` when no session exists. The `status`
 * field is read by TanStack Start's error serializer
 * (`getErrorStatus` → `error.status`), so server-fn callers get a real
 * 401 instead of a generic 500. Keep the message stable — callers and
 * tests match on "unauthenticated".
 */
export class UnauthenticatedError extends Error {
	readonly status = 401;
	constructor() {
		super("unauthenticated");
		this.name = "UnauthenticatedError";
	}
}

/**
 * Session helpers for plugin server functions — the same contract the
 * host's `lib/auth.ts` wrappers had, reached through the runtime
 * registry instead of the app's platform module (P-033).
 */
export async function getSessionUser(headers?: Headers): Promise<SessionUser | null> {
	const session = await run(
		Effect.gen(function* () {
			const auth = yield* Auth;
			// Auth.getSession is a Promise port; the span wraps the Effect
			// boundary where it is invoked. null session is normal — no logging.
			return yield* Effect.withSpan(
				Effect.promise(() => auth.getSession(headers ?? getRequestHeaders())),
				"Auth.getSession",
			);
		}),
	);
	if (!session) return null;
	return session.user;
}

export async function ensureSessionUser(headers?: Headers): Promise<SessionUser> {
	const user = await getSessionUser(headers);
	if (!user) throw new UnauthenticatedError();
	return user;
}

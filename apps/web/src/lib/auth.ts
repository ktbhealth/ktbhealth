import { getRequestHeaders } from "@tanstack/react-start/server";

import { Auth, type SessionUser } from "@ktb/auth";
import * as Effect from "effect/Effect";
import { run } from "#/lib/platform.ts";

export type { SessionUser };

export async function getSessionUser(headers?: Headers): Promise<SessionUser | null> {
	const session = await run(
		Effect.gen(function* () {
			const auth = yield* Auth;
			return yield* Effect.promise(() => auth.getSession(headers ?? getRequestHeaders()));
		}),
	);
	if (!session) return null;
	return session.user;
}

export async function ensureSessionUser(headers?: Headers): Promise<SessionUser> {
	const user = await getSessionUser(headers);
	if (!user) throw new Error("unauthenticated");
	return user;
}

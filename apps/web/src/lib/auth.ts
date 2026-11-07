import { getRequestHeaders } from "@tanstack/react-start/server";

import type { SessionUser } from "@ktb/auth";
import { auth } from "#/lib/platform.ts";

export type { SessionUser };

export async function getSessionUser(headers?: Headers): Promise<SessionUser | null> {
	const session = await auth.api.getSession({
		headers: headers ?? getRequestHeaders(),
	});
	if (!session) return null;
	return {
		id: session.user.id,
		email: session.user.email,
		name: session.user.name ?? null,
	};
}

export async function ensureSessionUser(headers?: Headers): Promise<SessionUser> {
	const user = await getSessionUser(headers);
	if (!user) throw new Error("unauthenticated");
	return user;
}

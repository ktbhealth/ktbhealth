import { redirect } from "@tanstack/react-router";

import { sessionUserFn } from "./fns.ts";

/**
 * Route guard for authenticated pages: anonymous visitors are sent to
 * /login. Data endpoints stay protected independently — server fns and
 * api handlers enforce the session themselves.
 */
export async function requireSession() {
	const user = await sessionUserFn();
	if (!user) throw redirect({ to: "/login" });
}

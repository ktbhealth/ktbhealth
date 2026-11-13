import { redirect } from "@tanstack/react-router";

import { doctorAccessFn } from "./fns.ts";

/**
 * Route guard for doctor pages: anonymous visitors are sent to /login,
 * signed-in accounts with no doctor profile to act as to the profile
 * chooser. Data endpoints stay protected independently — server fns and
 * api handlers enforce the acting doctor themselves.
 */
export async function requireDoctor() {
	const access = await doctorAccessFn();
	if (access === "anonymous") throw redirect({ to: "/login" });
	if (access === "no-doctor") throw redirect({ to: "/doctors/select" });
}

import { createServerFn } from "@tanstack/react-start";

import * as Effect from "effect/Effect";
import { Schema } from "effect";

import {
	ensureSessionUser,
	getDoctorContext,
	getLocale,
	runAs,
	setDoctorSelection,
} from "@ktb/server-fns";

import { Doctors } from "./index.ts";

// Doctors plugin server functions: the route modules under src/routes/**
// are owned by this package and reach the app runtime through
// @ktb/server-fns — no host imports.

const decodeNumber = Schema.decodeUnknownSync(Schema.Number);

/** Active UI locale for the current request — route loaders attach it
 * to their data so plugin views never import the host's i18n runtime. */
export const localeFn = createServerFn({ method: "GET" }).handler(() => getLocale());

/**
 * The doctor profiles the session user may act as and the one currently
 * in effect — null for anonymous visitors. An entry point: invites
 * addressed to the user's verified email are claimed first, so a newly
 * invited secretary sees the doctor right after signing in.
 */
export const doctorContextFn = createServerFn({ method: "GET" }).handler(async () => {
	const context = await getDoctorContext(undefined, { claimInvites: true });
	if (!context) return null;
	return {
		profiles: context.profiles.map(({ doctorId, displayName, role }) => ({
			doctorId,
			displayName,
			role,
		})),
		activeDoctorId: context.active?.doctorId ?? null,
	};
});

/** Act as `doctorId` from now on. Refused (`{ ok: false }`) for a
 * profile the user does not hold. */
export const selectDoctorFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: doctorId }) => {
		const context = await getDoctorContext();
		if (!context?.profiles.some((p) => p.doctorId === doctorId)) return { ok: false };
		await setDoctorSelection(doctorId);
		return { ok: true };
	});

/**
 * Create the session user's own doctor profile (idempotent) and act as
 * it — called right after a doctor sign-up, the only place a doctor
 * profile is created from. Patient accounts are never offered it.
 */
export const ensureDoctorProfileFn = createServerFn({ method: "POST" }).handler(async () => {
	const user = await ensureSessionUser();
	const doctor = await runAs(
		user,
		Effect.gen(function* () {
			const doctors = yield* Doctors;
			return yield* doctors.ensureProfile(user.name ?? user.email);
		}),
	);
	await setDoctorSelection(doctor.id);
	return { ok: true };
});

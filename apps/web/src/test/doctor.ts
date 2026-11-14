import { ensureDoctorProfile } from "@ktb/doctors";

/**
 * Sign up an account that is a doctor, like the /login sign-up does:
 * the better-auth user plus its own doctor profile. Without the profile
 * an account is not a doctor and doctor-scoped fns show it nothing.
 *
 * The platform module is imported lazily so tests can set bindings on
 * the worker env before the app is composed.
 */
export async function signUpDoctor(body: {
	readonly email: string;
	readonly password: string;
	readonly name: string;
}): Promise<void> {
	const { auth, db } = await import("#/lib/platform.ts");
	const { user } = await auth.api.signUpEmail({ body });
	await ensureDoctorProfile(db, user.id, body.name);
}

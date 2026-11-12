import * as Context from "effect/Context";

/** Authenticated principal — what every plugin sees, provider-agnostic. */
export interface SessionUser {
	readonly id: string;
	readonly email: string;
	readonly name: string | null;
}

export interface Session {
	readonly user: SessionUser;
	readonly sessionId: string;
	readonly expiresAt: Date;
}

/** Auth port: request → session. Impl lives in @ktb/auth-better. */
export class Auth extends Context.Service<
	Auth,
	{
		getSession(headers: Headers): Promise<Session | null>;
	}
>()("@ktb/auth/Auth") {}

export {
	actingAs,
	DOCTOR_PROFILE_COOKIE,
	DoctorProfiles,
	PATIENT_PROFILE_COOKIE,
	PatientProfiles,
	profileIdFromHeaders,
	resolveDoctorProfile,
	resolvePatientProfile,
	type ActingUser,
	type DoctorProfile,
	type PatientProfile,
} from "./profiles.ts";

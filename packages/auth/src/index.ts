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

/** Shape of the Auth port — exported so adapter implementations can
 * type their factory without re-declaring the contract. */
export interface AuthShape {
	getSession(headers: Headers): Promise<Session | null>;
	/**
	 * Platform suspension switch (T-034): `true` bans the user —
	 * `getSession` must return null for them and their existing
	 * sessions are revoked; `false` reactivates. Provider-agnostic:
	 * adapters map it onto their own user/session storage.
	 */
	setUserBanned(userId: string, banned: boolean): Promise<void>;
}

/** Auth port: request → session. Impl lives in @ktb/auth-better. */
export class Auth extends Context.Service<Auth, AuthShape>()("@ktb/auth/Auth") {}

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

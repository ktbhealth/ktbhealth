import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { SessionUser } from "./index.ts";

/**
 * Profiles — who a session user may act as. One account, several roles:
 * the role is derived from links (doctor profile, delegated doctor
 * access, patient access), never stored on the account itself.
 */

/** A doctor profile the user may act as: their own ("owner") or one
 * delegated to them ("secretary"). `userId`/`email` are the owning
 * doctor's account — `userId` is the id clinical data is scoped by. */
export interface DoctorProfile {
	readonly doctorId: number;
	readonly userId: string;
	readonly email: string;
	readonly displayName: string;
	readonly role: "owner" | "secretary";
}

/**
 * Doctor-profile directory port — the single answer to "who may this
 * user act as". Impl lives in the doctors plugin: the user's own
 * profile, plus whatever a deployed {@link DoctorDelegations} adds.
 */
export class DoctorProfiles extends Context.Service<
	DoctorProfiles,
	{
		/** Every doctor profile `userId` may act as — own profile first. */
		listFor(userId: string): Effect.Effect<readonly DoctorProfile[]>;
		/**
		 * Turn pending invites addressed to the user's *verified* email
		 * into active delegations; returns how many were claimed. A no-op
		 * for unverified addresses — an unproven email claims nothing —
		 * and when no delegation source is deployed.
		 */
		claimInvites(userId: string): Effect.Effect<number>;
	}
>()("@ktb/auth/DoctorProfiles") {}

/**
 * Delegation source — the optional extension of the directory: who,
 * besides its owner, may act as a doctor. The directory consults it
 * when one is deployed, so a deployment without it is simply one where
 * every doctor acts only for themselves.
 */
export class DoctorDelegations extends Context.Service<
	DoctorDelegations,
	{
		/** The profiles delegated to `userId` through an *active* delegation. */
		listFor(userId: string): Effect.Effect<readonly DoctorProfile[]>;
		/** Activate the pending invites addressed to the user's *verified*
		 * email; returns how many were claimed. */
		claimInvites(userId: string): Effect.Effect<number>;
	}
>()("@ktb/auth/DoctorDelegations") {}

/**
 * The user a request acts as on the doctor side. `id` is the acting
 * doctor's `user.id` (data scope); `actorId` is the signed-in user —
 * equal to `id` unless a secretary is acting on the doctor's behalf.
 * `email`/`name` always describe the signed-in user, so identity-based
 * gates (platform admin allowlist) are never inherited from the doctor.
 * `doctor` is the identity clinical documents are issued under.
 */
export interface ActingUser extends SessionUser {
	readonly actorId: string;
	readonly doctor: { readonly name: string | null; readonly email: string };
}

/** Cookie carrying the chosen doctor profile id. It is a selector only:
 * every request re-validates the link it points at. */
export const DOCTOR_PROFILE_COOKIE = "ktb_doctor";

/** The profile id selected through `cookieName`, or null when the cookie
 * is absent or not a positive integer. */
export const profileIdFromHeaders = (headers: Headers, cookieName: string): number | null => {
	for (const pair of (headers.get("cookie") ?? "").split(";")) {
		const eq = pair.indexOf("=");
		if (eq === -1 || pair.slice(0, eq).trim() !== cookieName) continue;
		const value = pair.slice(eq + 1).trim();
		return /^[1-9]\d*$/.test(value) ? Number(value) : null;
	}
	return null;
};

/** The user acting as `profile` on behalf of the signed-in `user`. */
export const actingAs = (user: SessionUser, profile: DoctorProfile | null): ActingUser =>
	profile === null
		? { ...user, actorId: user.id, doctor: { name: user.name, email: user.email } }
		: {
				id: profile.userId,
				email: user.email,
				name: user.name,
				actorId: user.id,
				doctor: { name: profile.displayName, email: profile.email },
			};

/**
 * The doctor profile a request acts as: the selected one when the user
 * holds it, otherwise their own, otherwise the only one delegated to
 * them. Null when the user holds no doctor profile, or holds several
 * delegated ones and has not chosen yet.
 */
export const resolveDoctorProfile = (
	profiles: readonly DoctorProfile[],
	selectedId: number | null,
): DoctorProfile | null =>
	profiles.find((p) => p.doctorId === selectedId) ??
	profiles.find((p) => p.role === "owner") ??
	(profiles.length === 1 ? profiles[0]! : null);

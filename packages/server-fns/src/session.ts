import {
	actingAs,
	Auth,
	DOCTOR_PROFILE_COOKIE,
	DoctorProfiles,
	PATIENT_PROFILE_COOKIE,
	PatientProfiles,
	profileIdFromHeaders,
	resolveDoctorProfile,
	resolvePatientProfile,
} from "@ktb/auth";
import type { ActingUser, DoctorProfile, PatientProfile, SessionUser } from "@ktb/auth";
import { tenantSelectorFromHeaders, type TenantSelector } from "@ktb/tenant/selector";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { run } from "./runtime.ts";

export type { ActingUser, DoctorProfile, PatientProfile, SessionUser };

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
// Lazy: `@tanstack/react-start/server` is server-only and its graph
// reaches react-dom/server (CJS). This module is reachable from client
// bundles through plugin index files, so a static import would break
// hydration; the dynamic import only resolves where it is invoked.
const requestHeadersOr = async (headers?: Headers): Promise<Headers> =>
	headers ?? (await import("@tanstack/react-start/server")).getRequestHeaders();

export async function getSessionUser(headers?: Headers): Promise<SessionUser | null> {
	const requestHeaders = await requestHeadersOr(headers);
	const session = await run(
		Effect.gen(function* () {
			const auth = yield* Auth;
			// Auth.getSession is a Promise port; the span wraps the Effect
			// boundary where it is invoked. null session is normal — no logging.
			return yield* Effect.withSpan(
				Effect.promise(() => auth.getSession(requestHeaders)),
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

/**
 * Thrown by `ensureDoctorUser` when the session user holds no doctor
 * profile to act as — a signed-in account that is not (yet) a doctor
 * nor anyone's secretary. `status` drives the serialized HTTP status.
 */
export class NotADoctorError extends Error {
	readonly status = 403;
	constructor() {
		super("forbidden");
		this.name = "NotADoctorError";
	}
}

/** Doctor-side context of a request: the signed-in user, every doctor
 * profile they may act as, and the one this request acts as. */
export interface DoctorContext {
	readonly user: SessionUser;
	readonly profiles: readonly DoctorProfile[];
	/** Null when the user holds no profile or a choice is still needed. */
	readonly active: DoctorProfile | null;
}

/**
 * Resolve the doctor-side context. The `ktb_doctor` selector cookie
 * picks among the profiles the `DoctorProfiles` directory returns for
 * the user; the directory is re-read on every request, so a revoked
 * delegation or a forged cookie selects nothing it should not.
 *
 * `claimInvites` first activates invites addressed to the user's
 * verified email — pass it on entry points (post-login, the profile
 * chooser), not on every request.
 *
 * Returns `profiles: null` when no directory is deployed: a single-role
 * app where every account acts for itself.
 */
async function resolveDoctorContext(
	headers: Headers | undefined,
	claimInvites: boolean,
): Promise<{
	user: SessionUser;
	profiles: readonly DoctorProfile[] | null;
	selectedId: number | null;
} | null> {
	const requestHeaders = await requestHeadersOr(headers);
	const user = await getSessionUser(requestHeaders);
	if (!user) return null;
	const profiles = await run(
		Effect.gen(function* () {
			const directory = yield* Effect.serviceOption(DoctorProfiles);
			if (Option.isNone(directory)) return null;
			if (claimInvites) yield* directory.value.claimInvites(user.id);
			return yield* directory.value.listFor(user.id);
		}),
	);
	return {
		user,
		profiles,
		selectedId: profileIdFromHeaders(requestHeaders, DOCTOR_PROFILE_COOKIE),
	};
}

export async function getDoctorContext(
	headers?: Headers,
	options?: { readonly claimInvites?: boolean },
): Promise<DoctorContext | null> {
	const resolved = await resolveDoctorContext(headers, options?.claimInvites === true);
	if (!resolved) return null;
	const profiles = resolved.profiles ?? [];
	return {
		user: resolved.user,
		profiles,
		active: resolveDoctorProfile(profiles, resolved.selectedId),
	};
}

/**
 * The user this request acts as on the doctor side — what doctor-scoped
 * server fns pass to `runAs` and to owner parameters instead of the raw
 * session user. Null for anonymous requests *and* for signed-in accounts
 * with no doctor profile to act as (see {@link getDoctorContext}), so
 * doctor data paths treat both as "nothing visible".
 */
export async function getDoctorUser(headers?: Headers): Promise<ActingUser | null> {
	const resolved = await resolveDoctorContext(headers, false);
	if (!resolved) return null;
	if (resolved.profiles === null) return actingAs(resolved.user, null);
	const active = resolveDoctorProfile(resolved.profiles, resolved.selectedId);
	return active === null ? null : actingAs(resolved.user, active);
}

/** The signed-in user as the app chrome sees them. */
export interface SessionAccount extends SessionUser {
	/**
	 * True when the account has no doctor side at all — no doctor profile
	 * of its own and none delegated to it: a patient account, which is
	 * shown the patient portal only. False when no directory is deployed
	 * (a single-role app where every account acts for itself).
	 */
	readonly patientOnly: boolean;
}

/** The session user plus which side of the app the account belongs to
 * — what the root layout renders its navigation from. Null when
 * anonymous. */
export async function getSessionAccount(headers?: Headers): Promise<SessionAccount | null> {
	const resolved = await resolveDoctorContext(headers, false);
	if (!resolved) return null;
	return {
		...resolved.user,
		patientOnly: resolved.profiles !== null && resolved.profiles.length === 0,
	};
}

/** Where a request stands on the doctor side — what route guards branch on. */
export type DoctorAccess = "anonymous" | "no-doctor" | "doctor";

/** "anonymous" without a session, "no-doctor" for a signed-in account
 * with no doctor profile to act as, "doctor" otherwise. */
export async function getDoctorAccess(headers?: Headers): Promise<DoctorAccess> {
	const requestHeaders = await requestHeadersOr(headers);
	if (await getDoctorUser(requestHeaders)) return "doctor";
	return (await getSessionUser(requestHeaders)) ? "no-doctor" : "anonymous";
}

/** Like {@link getDoctorUser}, failing 401 without a session and 403
 * for a signed-in account with no doctor profile to act as. */
export async function ensureDoctorUser(headers?: Headers): Promise<ActingUser> {
	const requestHeaders = await requestHeadersOr(headers);
	const acting = await getDoctorUser(requestHeaders);
	if (acting) return acting;
	if (await getSessionUser(requestHeaders)) throw new NotADoctorError();
	throw new UnauthenticatedError();
}

/** Selection cookies outlive the session cookie on purpose: they only
 * remember a preference and grant nothing without a valid session. */
const SELECTION_COOKIE = {
	path: "/",
	httpOnly: true,
	sameSite: "lax",
	secure: true,
	maxAge: 60 * 60 * 24 * 365,
} as const;

/**
 * Persist (or clear, with null) the doctor profile this browser acts
 * as. The cookie is a selector only — it grants nothing by itself, so
 * callers need not validate `doctorId` for safety, only for UX.
 */
export async function setDoctorSelection(doctorId: number | null): Promise<void> {
	const { deleteCookie, setCookie } = await import("@tanstack/react-start/server");
	if (doctorId === null) deleteCookie(DOCTOR_PROFILE_COOKIE, { path: SELECTION_COOKIE.path });
	else setCookie(DOCTOR_PROFILE_COOKIE, String(doctorId), SELECTION_COOKIE);
}

/** Persist (or clear, with null) the patient profile this browser opens
 * in the portal — a selector only, like {@link setDoctorSelection}. */
export async function setPatientSelection(patientId: number | null): Promise<void> {
	const { deleteCookie, setCookie } = await import("@tanstack/react-start/server");
	if (patientId === null) deleteCookie(PATIENT_PROFILE_COOKIE, { path: SELECTION_COOKIE.path });
	else setCookie(PATIENT_PROFILE_COOKIE, String(patientId), SELECTION_COOKIE);
}

/** Patient-portal context of a request: the signed-in user, every
 * patient record they hold active access to, and the one being opened. */
export interface PatientContext {
	readonly user: SessionUser;
	readonly profiles: readonly PatientProfile[];
	/** Null when nothing is linked yet or a choice is still needed. */
	readonly active: PatientProfile | null;
}

/**
 * Resolve the patient-portal context: the `ktb_patient` selector cookie
 * picks among the profiles the `PatientProfiles` directory returns for
 * the user — re-checked on every request; a cookie pointing at a record
 * the user holds no active access to selects nothing.
 *
 * `syncLinks` first claims invites — pass it on entry points (the
 * portal home), not on every request.
 */
export async function getPatientContext(
	headers?: Headers,
	options?: { readonly syncLinks?: boolean },
): Promise<PatientContext | null> {
	const requestHeaders = await requestHeadersOr(headers);
	const user = await getSessionUser(requestHeaders);
	if (!user) return null;
	const profiles = await run(
		Effect.gen(function* () {
			// Optional: absent when the patient-access plugin is not deployed.
			const directory = yield* Effect.serviceOption(PatientProfiles);
			if (Option.isNone(directory)) return [];
			if (options?.syncLinks === true) yield* directory.value.syncLinks(user.id);
			return yield* directory.value.listFor(user.id);
		}),
	);
	const selectedId = profileIdFromHeaders(requestHeaders, PATIENT_PROFILE_COOKIE);
	return { user, profiles, active: resolvePatientProfile(profiles, selectedId) };
}

/**
 * Tenant selector for the current request (P-053): reads the default
 * header transport (`x-tenant-id`/`x-tenant-slug`/`x-tenant-kind`/
 * `x-tenant`) via `tenantSelectorFromHeaders`. Pass the result as the
 * third argument to `runAs` so the composition root's TenantResolver
 * binds `Tenant` inside the request scope. Returns `null` when no
 * tenant header is present.
 */
export async function getTenantSelector(headers?: Headers): Promise<TenantSelector | null> {
	return tenantSelectorFromHeaders(await requestHeadersOr(headers));
}

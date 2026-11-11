import { createServerFn } from "@tanstack/react-start";

import { Notifications, rowToConsole } from "@ktb/notifications";
import { run, runAs, serverPlugins } from "#/lib/platform.ts";
import { platformPages } from "#/lib/platform-pages.ts";
import { PlatformAdmin } from "@ktb/platform";
import type { PanelPage } from "@ktb/kernel";
import { Schema } from "effect";
import { ensureSessionUser, getSessionUser } from "#/lib/auth.ts";
import * as Effect from "effect/Effect";

// Services enforce authorization and fail `Forbidden`; handlers translate
// denial into the same "not visible" response as a missing entity
// (null / { ok: false } / 404) via Effect.catchTag — other errors still
// propagate, no data leaks, no error boundary for stale links.

export const getSessionUserFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

export const sessionFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

/**
 * /platform console gate: true when the session user's email is in the
 * `PLATFORM_ADMIN_EMAILS` allowlist. Non-admins get `false` — route
 * guards turn that into a hard 404; admin data paths enforce the same
 * gate again inside domain services (defense in depth).
 */
export const platformAdminFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return false;
	return run(
		Effect.gen(function* () {
			const platformAdmin = yield* PlatformAdmin;
			return yield* platformAdmin.isAdmin(user.email);
		}),
	);
});

/**
 * Result of `platformPageDataFn`: a discriminated union so the route
 * loader can tell "page denied/missing" apart from a loader that
 * legitimately returned `null`/`undefined` data. Server-fn errors do
 * not round-trip as router `notFound()`, so denial is data, not a
 * throw — the route maps `notfound` to `throw notFound()`.
 */
export type PlatformPageDataResult =
	| { readonly status: "ok"; readonly data: any }
	| { readonly status: "notfound" };

/** Server-registry page lookup, built lazily on first dispatch — kept
 * out of module scope so the client bundle never evaluates it (the
 * `serverPlugins` import is handler-only, like `run`/`runAs`). */
let serverPages: ReadonlyMap<string, PanelPage> | undefined;

/**
 * Loader data for /platform console pages contributed via
 * `panel.pages` (P-050): resolves the descriptor registered for `path`
 * and runs its Effect under the session principal (`runAs` binds
 * Principal + AuthzLive — authz stays inside the domain services).
 * Anonymous callers, unknown paths and `guard` denials all collapse to
 * `{ status: "notfound" }` — the route dispatcher turns that into a 404
 * (same as a missing page). Pages without a loader get
 * `{ status: "ok", data: null }`.
 */
export const platformPageDataFn = createServerFn({ method: "GET" })
	.validator((input: unknown) => Schema.decodeUnknownSync(Schema.String)(input))
	// Loader results are plugin-defined `unknown` at the kernel
	// boundary; the wire type is whatever each page's loader returns
	// (serializable rows — same shape the retired per-page fns sent).
	.handler(async ({ data: path }): Promise<PlatformPageDataResult> => {
		const user = await getSessionUser();
		if (!user) return { status: "notfound" };
		const page = platformPages.get(path);
		if (page === undefined) return { status: "notfound" };
		// Page descriptors are split across the two registries: the client
		// manifest (platformPages) carries id/path/component, while
		// `guard`/`loader` stay server-side on the @ktb/app-host plugin
		// objects and never reach the browser bundle. A descriptor's own
		// handlers win when present — tests inject full pages directly.
		serverPages ??= new Map(
			serverPlugins.flatMap((p) => (p.panel?.pages ?? []).map((pg) => [pg.path, pg] as const)),
		);
		const serverPage = serverPages.get(path);
		const guard = page.guard ?? serverPage?.guard;
		const loader = page.loader ?? serverPage?.loader;
		// Page-level guard (feature flags / entitlements) runs before the
		// loader; `false` hides the page exactly like an unknown path.
		if (guard !== undefined) {
			const allowed = await runAs(user, guard());
			if (!allowed) return { status: "notfound" };
		}
		if (loader === undefined) return { status: "ok", data: null };
		return { status: "ok", data: await runAs(user, loader()) };
	});

// ---------- patients ----------
// Patient server functions are owned by the patients plugin (P-033) —
// its route modules and this host file share the same implementations
// through @ktb/patients/fns. Re-exported here so existing host callers
// (tests) keep their import path.
export {
	adminCreatePatientFn,
	createPatientFn,
	deletePatientFn,
	getPatientFn,
	listPatientsFn,
	patientConsultationsFn as listPatientConsultationsFn,
	patientDeletionImpactFn,
	updatePatientFn,
} from "@ktb/patients/fns";

// ---------- consultations ----------
// Consultation server functions are owned by the consultations plugin —
// its route modules (plugins/consultations/src/routes/**) and this host
// file share the same implementations through @ktb/consultations/fns.
// Re-exported here so existing host callers (tests, /platform routes)
// keep their import path.
export {
	adminCreateConsultationFn,
	adminDeleteConsultationFn,
	adminListAudioJobsFn,
	attachAnamnesisFn,
	extractAnamnesisFn,
	getConsultationFn,
	getLiveConsultationFn,
	listConsultationsFn,
	patientHistoryFn,
	recordConsentFn,
	saveConsultationFn,
} from "@ktb/consultations/fns";

// ---------- notifications ----------

/**
 * The session user's recent console notifications, mapped to the
 * serializable ConsoleNotification shape — seeds NotificationsDataContext
 * on /platform before the SSE feed takes over. Only called when the
 * notifications.services plugin is registered (the service tag is absent
 * otherwise).
 */
export const listMyNotificationsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return [];
	return runAs(
		user,
		Effect.gen(function* () {
			const notifications = yield* Notifications;
			const rows = yield* notifications.list(user.id, 50);
			return rows.map(rowToConsole);
		}),
	);
});

/** Exact unread count for the /platform dashboard card — the list fn
 * above is capped at 50 rows, so it can't be derived client-side. */
export const countMyUnreadNotificationsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return 0;
	return runAs(
		user,
		Effect.gen(function* () {
			const notifications = yield* Notifications;
			return yield* notifications.unreadCount(user.id);
		}),
	);
});

const decodeNotificationIds = Schema.decodeUnknownSync(Schema.Array(Schema.Number));

/** Mark specific notifications read — ids are the numeric row ids
 * behind ConsoleNotification.id. Missing/foreign ids are ignored by
 * the service's user-scoped UPDATE. */
export const markMyNotificationsReadFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeNotificationIds(input))
	.handler(async ({ data: ids }) => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.gen(function* () {
				const notifications = yield* Notifications;
				return yield* notifications.markRead(user.id, ids).pipe(
					Effect.as(true),
					Effect.catchTag("Forbidden", () => Effect.succeed(false)),
				);
			}),
		);
	});

export const markAllMyNotificationsReadFn = createServerFn({ method: "POST" }).handler(async () => {
	const user = await ensureSessionUser();
	return runAs(
		user,
		Effect.gen(function* () {
			const notifications = yield* Notifications;
			return yield* notifications.markAllRead(user.id).pipe(
				Effect.as(true),
				Effect.catchTag("Forbidden", () => Effect.succeed(false)),
			);
		}),
	);
});

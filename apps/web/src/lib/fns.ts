import { createServerFn } from "@tanstack/react-start";

import { Consultations } from "@ktb/consultations";
import { ConsultationsQueries } from "@ktb/consultations/api";
import { Query } from "@effect-server-utils/cqrs";
import { Patients } from "@ktb/patients";
import { demographicContext } from "@ktb/patients/record";
import type { PatientContext, PatientHistory } from "@ktb/anamnesis";
import { Notifications, rowToConsole } from "@ktb/notifications";
import { run, runAs } from "#/lib/platform.ts";
import { platformPages } from "#/lib/platform-pages.ts";
import { PlatformAdmin } from "@ktb/platform";
import { AnamnesisEngine } from "@ktb/anamnesis/services";
import { AnamnesisSchema } from "@ktb/anamnesis/schema";
import { Schema } from "effect";
import { ensureSessionUser, getSessionUser } from "#/lib/auth.ts";
import * as Effect from "effect/Effect";

// Services enforce authorization and fail `Forbidden`; handlers translate
// denial into the same "not visible" response as a missing entity
// (null / { ok: false } / 404) via Effect.catchTag — other errors still
// propagate, no data leaks, no error boundary for stale links.

// ---------- wire validation (effect/schema) ----------

const decodeNumber = Schema.decodeUnknownSync(Schema.Number);

const SaveInput = Schema.Struct({
	transcript: Schema.String,
	anamnesis: AnamnesisSchema,
	engine: Schema.String,
	patientId: Schema.optionalKey(Schema.Number),
});

const AttachInput = Schema.Struct({
	consultationId: Schema.Number,
	anamnesis: AnamnesisSchema,
	engine: Schema.String,
	patientId: Schema.optionalKey(Schema.Number),
});

const decodeSaveInput = (input: unknown) =>
	Schema.decodeUnknownSync(SaveInput)(normalizePatientId(input));
const decodeAttachInput = (input: unknown) =>
	Schema.decodeUnknownSync(AttachInput)(normalizePatientId(input));

/**
 * The wire payload may carry `patientId` as null/undefined (key present,
 * value absent after serialization) or a numeric string — none of which
 * `Schema.Number` accepts. Normalize before decoding: drop empty values,
 * coerce numeric strings, reject the rest via the schema as usual.
 */
function normalizePatientId(input: unknown): unknown {
	if (typeof input !== "object" || input === null) return input;
	const o = { ...(input as Record<string, unknown>) };
	const p = o.patientId;
	if (p === undefined || p === null || p === "") delete o.patientId;
	else if (typeof p === "string" && p.trim() !== "" && Number.isFinite(Number(p)))
		o.patientId = Number(p);
	else if (typeof p === "number" && !Number.isFinite(p)) delete o.patientId;
	return o;
}

const ExtractInput = Schema.Struct({
	transcript: Schema.String,
	patientId: Schema.optionalKey(Schema.Number),
});

const HistoryInput = Schema.Struct({
	patientId: Schema.Number,
	excludeId: Schema.optionalKey(Schema.Number),
});

const decodeExtractInput = (input: unknown) =>
	Schema.decodeUnknownSync(ExtractInput)(normalizePatientId(input));
const decodeHistoryInput = (input: unknown) =>
	Schema.decodeUnknownSync(HistoryInput)(normalizePatientId(input));

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
		// Page-level guard (feature flags / entitlements) runs before the
		// loader; `false` hides the page exactly like an unknown path.
		if (page.guard !== undefined) {
			const allowed = await runAs(user, page.guard());
			if (!allowed) return { status: "notfound" };
		}
		if (page.loader === undefined) return { status: "ok", data: null };
		return { status: "ok", data: await runAs(user, page.loader()) };
	});

// LLM helpers touch no owned data but still require a session: they proxy
// paid model calls and must not be an open endpoint.
export const extractAnamnesisFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeExtractInput(input))
	.handler(async ({ data }) => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.gen(function* () {
				// Linked patient → factual history of prior consultations is
				// fetched server-side and fed to the engine as context only.
				let history: PatientHistory | null = null;
				let patient: PatientContext | undefined;
				if (data.patientId !== undefined) {
					const consultations = yield* Consultations;
					// userId is always the caller's own — read authz cannot deny.
					history = yield* consultations.history(data.patientId, user.id);
					// Record demographics as drafter context; someone else's
					// patient is simply not used.
					const patients = yield* Patients;
					const record = yield* patients
						.get(user.id, data.patientId)
						.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
					if (record) patient = demographicContext(record);
				}
				const engine = yield* AnamnesisEngine;
				return yield* engine.extract({
					transcript: data.transcript,
					history: history ?? undefined,
					patient,
				});
			}),
		);
	});

/** Factual summary of a patient's prior consultations (review UI). */
export const patientHistoryFn = createServerFn({ method: "GET" })
	.validator((input: unknown) => decodeHistoryInput(input))
	.handler(async ({ data }) => {
		const user = await getSessionUser();
		if (!user) return null;
		return runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations.history(data.patientId, user.id, data.excludeId);
			}),
		);
	});

// ---------- patients ----------
// Patient server functions are owned by the patients plugin (P-033) —
// its route modules and this host file share the same implementations
// through @ktb/patients/fns. Re-exported here so existing host callers
// (consultations routes, tests) keep their import path.
export {
	createPatientFn,
	deletePatientFn,
	getPatientFn,
	listPatientsFn,
	patientConsultationsFn as listPatientConsultationsFn,
	patientDeletionImpactFn,
	updatePatientFn,
} from "@ktb/patients/fns";

// ---------- consultations (owner-scoped) ----------

export const saveConsultationFn = createServerFn({ method: "POST" })
	.validator((input) => decodeSaveInput(input))
	.handler(async ({ data }) => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations.save(user.id, data);
			}),
		);
	});

export const listConsultationsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return [];
	return runAs(
		user,
		Effect.gen(function* () {
			const consultations = yield* Consultations;
			return yield* consultations.list(user.id);
		}),
	);
});

export const getConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return null;
		// Non-owner access fails Forbidden inside the service → null (404).
		return runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations
					.get(id, user.id)
					.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
			}),
		);
	});

export const getLiveConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return null;
		return runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations
					.getLive(id, user.id)
					.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
			}),
		);
	});

export const attachAnamnesisFn = createServerFn({ method: "POST" })
	.validator((input) => decodeAttachInput(input))
	.handler(async ({ data }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		return runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				const ok = yield* consultations.attachAnamnesis(user.id, data).pipe(
					Effect.as(true),
					Effect.catchTag("Forbidden", () => Effect.succeed(false)),
				);
				return { ok };
			}),
		);
	});

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

/**
 * Cross-owner audio-pipeline rows for the /platform jobs feed — the
 * `consultations.audioJobs` CQRS query, dispatched inside runAs so the
 * bound Principal reaches the handler's platform-admin check. Non-admins
 * (the layout guard 404s them first anyway) get the same empty feed as
 * an empty table.
 */
export const adminListAudioJobsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return [];
	return runAs(
		user,
		Effect.scoped(
			Effect.gen(function* () {
				const queries = yield* Query.dispatcher(ConsultationsQueries);
				return yield* queries["consultations.audioJobs"]({}).pipe(
					Effect.catchTag("Forbidden", () => Effect.succeed([])),
				);
			}),
		),
	);
});

/** Record the doctor's consent declaration (LGPD trail). */
export const recordConsentFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		return runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				const ok = yield* consultations.recordConsent(id, user.id).pipe(
					Effect.as(true),
					Effect.catchTag("Forbidden", () => Effect.succeed(false)),
				);
				return { ok };
			}),
		);
	});

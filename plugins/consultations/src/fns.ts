import { createServerFn } from "@tanstack/react-start";

import { Query } from "@effect-server-utils/cqrs";
import * as Effect from "effect/Effect";
import { Schema } from "effect";

import {
	ensureSessionUser,
	getLocale,
	getServerRuntime,
	getSessionUser,
	purgeAudio,
	runAs,
} from "@ktb/server-fns";
import { AnamnesisEngine } from "@ktb/anamnesis/services";
import { AnamnesisSchema } from "@ktb/anamnesis/schema";
import type { PatientContext, PatientHistory } from "@ktb/anamnesis";
import { demographicContext } from "@ktb/patients/record";
import { Patients } from "@ktb/patients";

import { Consultations } from "./index.ts";
import { ConsultationsQueries } from "./api.ts";

// Consultations plugin server functions: the route modules under
// src/routes/** are owned by this package and reach the app runtime
// through @ktb/server-fns — no host imports. Services enforce
// authorization and fail `Forbidden`; handlers translate denial into the
// same "not visible" response as a missing entity (null / { ok: false })
// via Effect.catchTag — other errors still propagate.

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
	// Tri-state patientId: absent keeps the link, null clears it, a
	// number re-links (ownership is enforced in the service).
	patientId: Schema.optionalKey(Schema.NullishOr(Schema.Number)),
});

const decodeSaveInput = (input: unknown) =>
	Schema.decodeUnknownSync(SaveInput)(normalizePatientId(input));
const decodeAttachInput = (input: unknown) => {
	const normalized = normalizePatientId(input);
	// normalizePatientId drops null ("absent") — but for attach, an
	// explicit null means "clear the patient link", so restore it.
	if (
		typeof input === "object" &&
		input !== null &&
		(input as Record<string, unknown>).patientId === null
	) {
		// normalizePatientId returns a fresh object for any object input.
		(normalized as Record<string, unknown>).patientId = null;
	}
	return Schema.decodeUnknownSync(AttachInput)(normalized);
};

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

/** Session user for route guards — null when anonymous. */
export const sessionUserFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

/** Active UI locale for the current request — route loaders attach it
 * to their data so plugin views never import the host's i18n runtime. */
export const localeFn = createServerFn({ method: "GET" }).handler(() => getLocale());

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

const AdminCreateInput = Schema.Struct({
	userId: Schema.String,
	patientId: Schema.optionalKey(Schema.Number),
	transcript: Schema.optionalKey(Schema.String),
	source: Schema.optionalKey(Schema.String),
	status: Schema.optionalKey(Schema.String),
});
const decodeAdminCreateInput = Schema.decodeUnknownSync(AdminCreateInput);

/**
 * Platform-admin create on behalf of another user — the service
 * re-checks the PlatformAdmin gate; non-admins get `{ ok: false }`.
 */
export const adminCreateConsultationFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodeAdminCreateInput(input))
	.handler(async ({ data }) => {
		const user = await ensureSessionUser();
		return runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				const id = yield* consultations
					.adminCreate({ ...data, source: data.source ?? "manual" })
					.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
				return id === null ? { ok: false as const } : { ok: true as const, id };
			}),
		);
	});

/**
 * Platform-admin delete — removes the row and purges the stored
 * recording. Missing row or non-admin → `{ ok: false }`.
 */
export const adminDeleteConsultationFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await ensureSessionUser();
		const result = await runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations
					.adminDelete(id)
					.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
			}),
		);
		if (result === null) return { ok: false as const };
		const leftover = await purgeAudio(
			getServerRuntime().audio,
			result.audioKey === null ? [] : [result.audioKey],
		);
		return { ok: true as const, orphanedAudio: leftover.length };
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

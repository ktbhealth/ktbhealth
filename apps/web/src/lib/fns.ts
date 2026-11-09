import { createServerFn } from "@tanstack/react-start";

import { Consultations } from "@ktb/consultations";
import { Patients } from "@ktb/patients";
import { demographicContext, TEXT_FIELDS, validatePatient } from "@ktb/patients/record";
import type { PatientContext, PatientHistory } from "@ktb/anamnesis";
import { runAs } from "#/lib/platform.ts";
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

// Patient record: every FHIR text field optional/nullable on the wire;
// semantic validation (codes, CPF/CNS, dates) is validatePatient's job.
const draftFields = Object.fromEntries(
	TEXT_FIELDS.map((k) => [k, Schema.optionalKey(Schema.NullishOr(Schema.String))]),
);
const PatientDraftInput = Schema.Struct({
	...draftFields,
	active: Schema.optionalKey(Schema.Boolean),
});
const PatientUpdateInput = Schema.Struct({
	...draftFields,
	active: Schema.optionalKey(Schema.Boolean),
	id: Schema.Number,
});

const decodePatientDraft = Schema.decodeUnknownSync(PatientDraftInput);
/** `id` tolerates a numeric string, like `patientId` elsewhere. */
const decodePatientUpdate = (input: unknown) => {
	const o = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
	const id = typeof o.id === "string" && o.id.trim() !== "" ? Number(o.id) : o.id;
	return Schema.decodeUnknownSync(PatientUpdateInput)({ ...o, id });
};

const decodeExtractInput = (input: unknown) =>
	Schema.decodeUnknownSync(ExtractInput)(normalizePatientId(input));
const decodeHistoryInput = (input: unknown) =>
	Schema.decodeUnknownSync(HistoryInput)(normalizePatientId(input));

export const getSessionUserFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

export const sessionFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

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
// All domain calls go through `runAs(user, …)`: the service enforces
// ownership via the bound Principal — no handler-level requireCan.

export const listPatientsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return [];
	return runAs(
		user,
		Effect.gen(function* () {
			const patients = yield* Patients;
			return yield* patients.list(user.id);
		}),
	);
});

export const getPatientFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return null;
		// Someone else's patient fails Forbidden inside the service → null (404).
		return runAs(
			user,
			Effect.gen(function* () {
				const patients = yield* Patients;
				return yield* patients
					.get(user.id, id)
					.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
			}),
		);
	});

/** Field errors come back as data (`ok: false`) so the form can show them inline. */
export const createPatientFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodePatientDraft(input))
	.handler(async ({ data }) => {
		const user = await ensureSessionUser();
		const result = validatePatient(data);
		if (!result.ok) return { ok: false as const, errors: result.errors };
		return runAs(
			user,
			Effect.gen(function* () {
				const patients = yield* Patients;
				const patient = yield* patients.create(user.id, result.fields);
				return patient ? { ok: true as const, patient } : { ok: false as const, errors: {} };
			}),
		);
	});

export const updatePatientFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => decodePatientUpdate(input))
	.handler(async ({ data: { id, ...draft } }) => {
		const user = await ensureSessionUser();
		const result = validatePatient(draft);
		if (!result.ok) return { ok: false as const, errors: result.errors };
		return runAs(
			user,
			Effect.gen(function* () {
				const patients = yield* Patients;
				// Missing or not owned → same "not saved" answer.
				const patient = yield* patients
					.update(user.id, id, result.fields)
					.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
				return patient ? { ok: true as const, patient } : { ok: false as const, errors: {} };
			}),
		);
	});

/** The patient record page's consultation list (owner-scoped). */
export const listPatientConsultationsFn = createServerFn({ method: "GET" })
	.validator((patientId: number) => decodeNumber(patientId))
	.handler(async ({ data: patientId }) => {
		const user = await getSessionUser();
		if (!user) return [];
		return runAs(
			user,
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations.list(user.id, patientId);
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

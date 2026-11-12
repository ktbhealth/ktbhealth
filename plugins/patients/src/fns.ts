import { createServerFn } from "@tanstack/react-start";

import { Command, Query } from "@effect-server-utils/cqrs";
import * as Effect from "effect/Effect";
import { Schema } from "effect";

import {
	ensureDoctorUser,
	getDoctorAccess,
	getDoctorUser,
	getLocale,
	getServerRuntime,
	getSessionUser,
	purgeAudio,
	runAs,
} from "@ktb/server-fns";

import { Patients } from "./index.ts";
import { TEXT_FIELDS, validatePatient } from "./record.ts";
import { PatientCascadeCommands, PatientRecordConsultationsQueries } from "./api.ts";

// Patients plugin server functions (P-033): the route modules under
// src/routes/** are owned by this package and reach the app runtime
// through @ktb/server-fns — no host imports. Services enforce
// authorization and fail `Forbidden`; handlers translate denial into the
// same "not visible" response as a missing entity (null / { ok: false })
// via Effect.catchTag — other errors still propagate.

// ---------- wire validation (effect/schema) ----------

const decodeNumber = Schema.decodeUnknownSync(Schema.Number);

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

/** Session user for route guards — null when anonymous. */
export const sessionUserFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

/** Doctor-side standing of the request — drives the route guard. */
export const doctorAccessFn = createServerFn({ method: "GET" }).handler(() => getDoctorAccess());

/** Active UI locale for the current request — route loaders attach it
 * to their data so plugin views never import the host's i18n runtime. */
export const localeFn = createServerFn({ method: "GET" }).handler(() => getLocale());

// ---------- patients ----------
// All domain calls go through `runAs(user, …)`: the service enforces
// ownership via the bound Principal — no handler-level requireCan.

export const listPatientsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getDoctorUser();
	if (!user) return [];
	return runAs(
		user,
		Effect.gen(function* () {
			const patients = yield* Patients;
			return yield* patients.list(user.id);
		}),
	);
});

/** What deleting a patient takes with it — shown before the doctor confirms. */
export const patientDeletionImpactFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getDoctorUser();
		if (!user) return null;
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const patients = yield* Patients;
					const patient = yield* patients
						.get(user.id, id)
						.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
					if (!patient) return null;
					const queries = yield* Query.dispatcher(PatientRecordConsultationsQueries);
					const consultations = yield* queries["patients.recordConsultations"]({
						patientId: id,
					});
					return { consultations: consultations.length };
				}),
			),
		);
	});

/**
 * Permanently delete a patient and every consultation linked to them
 * (one D1 batch), then purge their recordings from R2. Missing or not
 * owned → `{ ok: false }`.
 */
export const deletePatientFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await ensureDoctorUser();
		const result = await runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const commands = yield* Command.dispatcher(PatientCascadeCommands);
					return yield* commands["patients.deleteCascade"]({ patientId: id }).pipe(
						Effect.catchTag("Forbidden", () => Effect.succeed(null)),
					);
				}),
			),
		);
		if (!result) return { ok: false as const };
		const leftover = await purgeAudio(getServerRuntime().audio, result.audioKeys);
		return {
			ok: true as const,
			consultations: result.consultations,
			/** Recordings still in storage after a failed purge (0 when clean). */
			orphanedAudio: leftover.length,
		};
	});

export const getPatientFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getDoctorUser();
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
		const user = await ensureDoctorUser();
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
		const user = await ensureDoctorUser();
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

/** The patient record page's consultation list (owner-scoped) — the
 * `patients.recordConsultations` CQRS query, dispatched inside runAs so
 * the bound Principal reaches the handler's authz checks. */
export const patientConsultationsFn = createServerFn({ method: "GET" })
	.validator((patientId: number) => decodeNumber(patientId))
	.handler(async ({ data: patientId }) => {
		const user = await getDoctorUser();
		if (!user) return [];
		return runAs(
			user,
			Effect.scoped(
				Effect.gen(function* () {
					const queries = yield* Query.dispatcher(PatientRecordConsultationsQueries);
					return yield* queries["patients.recordConsultations"]({ patientId });
				}),
			),
		);
	});

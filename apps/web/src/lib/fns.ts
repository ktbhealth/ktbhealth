import { createServerFn } from "@tanstack/react-start";

import { Consultations } from "@ktb/consultations";
import { Patients } from "@ktb/patients";
import { run } from "#/lib/platform.ts";
import { extractAnamnesis } from "@ktb/anamnesis-llm";
import { reviewAnamnesis } from "@ktb/anamnesis-llm";
import type { Anamnesis } from "@ktb/anamnesis";
import { AnamnesisReviewSchema, AnamnesisSchema } from "@ktb/anamnesis/schema";
import { Schema } from "effect";
import { ensureSessionUser, getSessionUser } from "#/lib/auth.ts";
import { AuthzLive, type can, requireCan } from "@ktb/authz";
import * as Effect from "effect/Effect";

const assertCan = async (userId: string, ...args: Parameters<typeof can>) => {
	await Effect.runPromise(requireCan(...args).pipe(Effect.provide(AuthzLive(userId))));
};

// ---------- wire validation (effect/schema) ----------

const decodeString = Schema.decodeUnknownSync(Schema.String);
const decodeNumber = Schema.decodeUnknownSync(Schema.Number);

const ReviewInput = Schema.Struct({
	transcript: Schema.String,
	anamnesis: AnamnesisSchema,
});

const SaveInput = Schema.Struct({
	transcript: Schema.String,
	anamnesis: AnamnesisSchema,
	engine: Schema.String,
	patientId: Schema.optionalKey(Schema.Number),
	review: Schema.optionalKey(Schema.NullOr(AnamnesisReviewSchema)),
});

const AttachInput = Schema.Struct({
	consultationId: Schema.Number,
	anamnesis: AnamnesisSchema,
	engine: Schema.String,
	patientId: Schema.optionalKey(Schema.Number),
	review: Schema.optionalKey(Schema.NullOr(AnamnesisReviewSchema)),
});

const decodeReviewInput = Schema.decodeUnknownSync(ReviewInput);
const decodeSaveInput = Schema.decodeUnknownSync(SaveInput);
const decodeAttachInput = Schema.decodeUnknownSync(AttachInput);

export const getSessionUserFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

export const sessionFn = createServerFn({ method: "GET" }).handler(() => getSessionUser());

export const extractAnamneseFn = createServerFn({ method: "POST" })
	.validator((transcript: string) => decodeString(transcript))
	.handler(({ data: transcript }) => extractAnamnesis(transcript));

/** Second opinion (stronger model): gaps, hypotheses, red flags. */
export const reviewAnamneseFn = createServerFn({ method: "POST" })
	.validator((input: { transcript: string; anamnesis: Anamnesis }) => decodeReviewInput(input))
	.handler(({ data }) => reviewAnamnesis(data.transcript, data.anamnesis));

// ---------- patients ----------

export const listPatientsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return [];
	return run(
		Effect.gen(function* () {
			const patients = yield* Patients;
			return yield* patients.list(user.id);
		}),
	);
});

export const createPatientFn = createServerFn({ method: "POST" })
	.validator((name: string) => decodeString(name))
	.handler(async ({ data: name }) => {
		const user = await ensureSessionUser();
		await assertCan(user.id, "patient.create");
		return run(
			Effect.gen(function* () {
				const patients = yield* Patients;
				return yield* patients.create(user.id, name);
			}),
		);
	});

// ---------- consultations (owner-scoped) ----------

export const saveConsultationFn = createServerFn({ method: "POST" })
	.validator((input) => decodeSaveInput(input))
	.handler(async ({ data }) => {
		const user = await ensureSessionUser();
		return run(
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations.save(user.id, data);
			}),
		);
	});

export const listConsultationsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return [];
	return run(
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
		const detail = await run(
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations.get(id, user.id);
			}),
		);
		if (!detail) return null;
		await assertCan(user.id, "consultation.read", { userId: user.id });
		return detail;
	});

export const getLiveConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return null;
		return run(
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations.getLive(id, user.id);
			}),
		);
	});

export const attachAnamnesisFn = createServerFn({ method: "POST" })
	.validator((input) => decodeAttachInput(input))
	.handler(async ({ data }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		await run(
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations.attachAnamnesis(user.id, data);
			}),
		);
		return { ok: true };
	});

/** Record the doctor's consent declaration (LGPD trail). */
export const recordConsentFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		await run(
			Effect.gen(function* () {
				const consultations = yield* Consultations;
				return yield* consultations.recordConsent(id, user.id);
			}),
		);
		return { ok: true };
	});

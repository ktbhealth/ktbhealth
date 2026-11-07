import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";

import { createPatient, listPatients } from "@ktb/patients";
import { withDb } from "#/lib/platform.ts";
import { consultations } from "@ktb/db/schema";
import { patients } from "@ktb/patients/schema";
import { extractAnamnesis } from "@ktb/anamnesis-llm";
import { reviewAnamnesis } from "@ktb/anamnesis-llm";
import type { Anamnesis } from "@ktb/anamnesis";
import {
	AnamnesisReviewSchema,
	AnamnesisSchema,
	decodeAnamnesisOption,
	decodeAnamnesisReviewOption,
} from "@ktb/anamnesis/schema";
import { Option, Schema } from "effect";
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

/** Stored JSON columns → typed domain objects, None on any drift. */
const parseStored = <A>(
	json: string | null,
	decode: (u: unknown) => Option.Option<A>,
): A | null => {
	if (!json) return null;
	try {
		return Option.getOrNull(decode(JSON.parse(json)));
	} catch {
		return null;
	}
};

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
	return withDb((db) => listPatients(db, user.id));
});

export const createPatientFn = createServerFn({ method: "POST" })
	.validator((name: string) => decodeString(name))
	.handler(async ({ data: name }) => {
		const user = await ensureSessionUser();
		await assertCan(user.id, "patient.create");
		return withDb((db) => createPatient(db, user.id, name));
	});

// ---------- consultations (owner-scoped) ----------

export const saveConsultationFn = createServerFn({ method: "POST" })
	.validator((input) => decodeSaveInput(input))
	.handler(async ({ data }) => {
		const user = await ensureSessionUser();
		const rows = await withDb((db) =>
			db
				.insert(consultations)
				.values({
					userId: user.id,
					patientId: data.patientId ?? null,
					transcript: data.transcript,
					anamnesis: JSON.stringify(data.anamnesis),
					engine: data.engine,
					review: data.review ? JSON.stringify(data.review) : null,
					createdAt: new Date(),
				})
				.returning({ id: consultations.id }),
		);
		return { id: rows[0]?.id };
	});

export const listConsultationsFn = createServerFn({ method: "GET" }).handler(async () => {
	const user = await getSessionUser();
	if (!user) return [];
	const rows = await withDb((db) =>
		db
			.select({
				id: consultations.id,
				engine: consultations.engine,
				createdAt: consultations.createdAt,
				transcript: consultations.transcript,
				source: consultations.source,
				status: consultations.status,
				consentAt: consultations.consentAt,
				anamnesis: consultations.anamnesis,
				review: consultations.review,
				patientName: patients.name,
			})
			.from(consultations)
			.leftJoin(patients, eq(consultations.patientId, patients.id))
			.where(eq(consultations.userId, user.id))
			.orderBy(desc(consultations.id)),
	);
	return rows.map(({ anamnesis, review, ...c }) => {
		const parsed = parseStored(anamnesis, decodeAnamnesisOption);
		return {
			...c,
			hasAnamnesis: anamnesis !== null,
			hasReview: review !== null,
			queixa: parsed?.queixa_principal.content ?? null,
		};
	});
});

export const getConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return null;
		const rows = await withDb((db) =>
			db
				.select({ c: consultations, patientName: patients.name })
				.from(consultations)
				.leftJoin(patients, eq(consultations.patientId, patients.id))
				.where(and(eq(consultations.id, id), eq(consultations.userId, user.id)))
				.limit(1),
		);
		const row = rows[0];
		if (!row) return null;
		await assertCan(user.id, "consultation.read", { userId: user.id });
		return {
			...row.c,
			patientName: row.patientName,
			anamnesis: parseStored(row.c.anamnesis, decodeAnamnesisOption),
			review: parseStored(row.c.review, decodeAnamnesisReviewOption),
		};
	});

export const getLiveConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return null;
		const rows = await withDb((db) =>
			db
				.select({
					transcript: consultations.transcript,
					status: consultations.status,
				})
				.from(consultations)
				.where(and(eq(consultations.id, id), eq(consultations.userId, user.id)))
				.limit(1),
		);
		return rows[0] ?? null;
	});

export const attachAnamnesisFn = createServerFn({ method: "POST" })
	.validator((input) => decodeAttachInput(input))
	.handler(async ({ data }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		await withDb((db) =>
			db
				.update(consultations)
				.set({
					anamnesis: JSON.stringify(data.anamnesis),
					engine: data.engine,
					review: data.review ? JSON.stringify(data.review) : null,
					patientId: data.patientId ?? null,
					status: "done",
				})
				.where(and(eq(consultations.id, data.consultationId), eq(consultations.userId, user.id))),
		);
		return { ok: true };
	});

/** Record the doctor's consent declaration (LGPD trail). */
export const recordConsentFn = createServerFn({ method: "POST" })
	.validator((id: number) => decodeNumber(id))
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		await withDb((db) =>
			db
				.update(consultations)
				.set({ consentAt: new Date() })
				.where(and(eq(consultations.id, id), eq(consultations.userId, user.id))),
		);
		return { ok: true };
	});

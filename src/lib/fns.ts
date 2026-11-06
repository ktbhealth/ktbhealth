import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { consultations, patients } from "#/db/schema.ts";
import { type Anamnesis, extractAnamnesis } from "#/lib/anamnese/index.ts";
import { ensureSessionUser, getSessionUser, signIn } from "#/lib/auth.ts";

export const getSessionUserFn = createServerFn({ method: "GET" }).handler(() =>
	getSessionUser(),
);

export const ensureUserFn = createServerFn({ method: "GET" }).handler(() =>
	ensureSessionUser(),
);

export const signInFn = createServerFn({ method: "POST" })
	.validator((name: string) => name)
	.handler(({ data: name }) => signIn(name));

export const extractAnamneseFn = createServerFn({ method: "POST" })
	.validator((transcript: string) => transcript)
	.handler(({ data: transcript }) => extractAnamnesis(transcript));

// ---------- patients ----------

export const listPatientsFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const user = await getSessionUser();
		if (!user) return [];
		return db.select().from(patients).where(eq(patients.ownerId, user.id));
	},
);

export const createPatientFn = createServerFn({ method: "POST" })
	.validator((name: string) => name)
	.handler(async ({ data: name }) => {
		const user = await ensureSessionUser();
		const rows = await db
			.insert(patients)
			.values({ ownerId: user.id, name, createdAt: new Date() })
			.returning();
		return rows[0] ?? null;
	});

// ---------- consultations (owner-scoped) ----------

export const saveConsultationFn = createServerFn({ method: "POST" })
	.validator(
		(input: {
			transcript: string;
			anamnesis: Anamnesis;
			engine: string;
			patientId?: number;
		}) => input,
	)
	.handler(async ({ data }) => {
		const user = await ensureSessionUser();
		const rows = await db
			.insert(consultations)
			.values({
				userId: user.id,
				patientId: data.patientId ?? null,
				transcript: data.transcript,
				anamnesis: JSON.stringify(data.anamnesis),
				engine: data.engine,
				createdAt: new Date(),
			})
			.returning({ id: consultations.id });
		return { id: rows[0]?.id };
	});

export const listConsultationsFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const user = await getSessionUser();
		if (!user) return [];
		return db
			.select({
				id: consultations.id,
				engine: consultations.engine,
				createdAt: consultations.createdAt,
				transcript: consultations.transcript,
				source: consultations.source,
				patientName: patients.name,
			})
			.from(consultations)
			.leftJoin(patients, eq(consultations.patientId, patients.id))
			.where(eq(consultations.userId, user.id))
			.orderBy(desc(consultations.id));
	},
);

export const getConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => id)
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return null;
		const rows = await db
			.select({ c: consultations, patientName: patients.name })
			.from(consultations)
			.leftJoin(patients, eq(consultations.patientId, patients.id))
			.where(and(eq(consultations.id, id), eq(consultations.userId, user.id)))
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return {
			...row.c,
			patientName: row.patientName,
			anamnesis: row.c.anamnesis
				? (JSON.parse(row.c.anamnesis) as Anamnesis)
				: null,
		};
	});

export const getLiveConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => id)
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return null;
		const rows = await db
			.select({
				transcript: consultations.transcript,
				status: consultations.status,
			})
			.from(consultations)
			.where(and(eq(consultations.id, id), eq(consultations.userId, user.id)))
			.limit(1);
		return rows[0] ?? null;
	});

export const attachAnamnesisFn = createServerFn({ method: "POST" })
	.validator(
		(input: {
			consultationId: number;
			anamnesis: Anamnesis;
			engine: string;
			patientId?: number;
		}) => input,
	)
	.handler(async ({ data }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		await db
			.update(consultations)
			.set({
				anamnesis: JSON.stringify(data.anamnesis),
				engine: data.engine,
				patientId: data.patientId ?? null,
				status: "done",
			})
			.where(
				and(
					eq(consultations.id, data.consultationId),
					eq(consultations.userId, user.id),
				),
			);
		return { ok: true };
	});

/** Record the doctor's consent declaration (LGPD trail). */
export const recordConsentFn = createServerFn({ method: "POST" })
	.validator((consultationId: number) => consultationId)
	.handler(async ({ data: id }) => {
		const user = await getSessionUser();
		if (!user) return { ok: false };
		await db
			.update(consultations)
			.set({ consentAt: new Date() })
			.where(and(eq(consultations.id, id), eq(consultations.userId, user.id)));
		return { ok: true };
	});

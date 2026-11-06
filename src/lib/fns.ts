import { createServerFn } from "@tanstack/react-start";
import { desc, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { consultations } from "#/db/schema.ts";
import { type Anamnesis, extractAnamnesis } from "#/lib/anamnese/index.ts";

export const extractAnamneseFn = createServerFn({ method: "POST" })
	.validator((transcript: string) => transcript)
	.handler(({ data: transcript }) => extractAnamnesis(transcript));

export const saveConsultationFn = createServerFn({ method: "POST" })
	.validator(
		(input: { transcript: string; anamnesis: Anamnesis; engine: string }) =>
			input,
	)
	.handler(async ({ data }) => {
		const rows = await db
			.insert(consultations)
			.values({
				transcript: data.transcript,
				anamnesis: JSON.stringify(data.anamnesis),
				engine: data.engine,
				createdAt: new Date(),
			})
			.returning({ id: consultations.id });
		return { id: rows[0]?.id };
	});

export const listConsultationsFn = createServerFn({ method: "GET" }).handler(
	() =>
		db
			.select({
				id: consultations.id,
				engine: consultations.engine,
				createdAt: consultations.createdAt,
				transcript: consultations.transcript,
			})
			.from(consultations)
			.orderBy(desc(consultations.id)),
);

export const getConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => id)
	.handler(async ({ data: id }) => {
		const rows = await db
			.select()
			.from(consultations)
			.where(eq(consultations.id, id))
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return {
			...row,
			anamnesis: row.anamnesis
				? (JSON.parse(row.anamnesis) as Anamnesis)
				: null,
		};
	});

export const getLiveConsultationFn = createServerFn({ method: "GET" })
	.validator((id: number) => id)
	.handler(async ({ data: id }) => {
		const rows = await db
			.select({
				transcript: consultations.transcript,
				status: consultations.status,
			})
			.from(consultations)
			.where(eq(consultations.id, id))
			.limit(1);
		return rows[0] ?? null;
	});

export const attachAnamnesisFn = createServerFn({ method: "POST" })
	.validator(
		(input: { consultationId: number; anamnesis: Anamnesis; engine: string }) =>
			input,
	)
	.handler(async ({ data }) => {
		await db
			.update(consultations)
			.set({
				anamnesis: JSON.stringify(data.anamnesis),
				engine: data.engine,
				status: "done",
			})
			.where(eq(consultations.id, data.consultationId));
		return { ok: true };
	});

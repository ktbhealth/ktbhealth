import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { consultations } from "#/db/schema.ts";

export async function createConsultation(fields: {
	userId: number;
	transcript?: string;
	source: string;
	status?: string;
	botId?: string;
}) {
	const rows = await db
		.insert(consultations)
		.values({
			userId: fields.userId,
			transcript: fields.transcript ?? "",
			source: fields.source,
			status: fields.status ?? "done",
			botId: fields.botId ?? null,
			createdAt: new Date(),
		})
		.returning({ id: consultations.id });
	return rows[0]?.id ?? null;
}

/** Append a transcript chunk (webhook sources — diarized or not). */
export async function appendTranscript(consultationId: number, text: string) {
	const rows = await db
		.select({ transcript: consultations.transcript })
		.from(consultations)
		.where(eq(consultations.id, consultationId))
		.limit(1);
	const current = rows[0]?.transcript ?? "";
	await db
		.update(consultations)
		.set({ transcript: `${current}${current ? "\n" : ""}${text}` })
		.where(eq(consultations.id, consultationId));
}

export async function finishConsultation(consultationId: number) {
	await db
		.update(consultations)
		.set({ status: "done" })
		.where(eq(consultations.id, consultationId));
}

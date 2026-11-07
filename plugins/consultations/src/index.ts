import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Option } from "effect";
import { and, desc, eq } from "drizzle-orm";

import { Db, type DbClient } from "@ktb/db";
import { definePlugin } from "@ktb/kernel";
import type { Anamnesis, AnamnesisReview } from "@ktb/anamnesis";
import { decodeAnamnesisOption, decodeAnamnesisReviewOption } from "@ktb/anamnesis/schema";
import { patients } from "@ktb/patients/schema";
import { consultations } from "./schema.ts";

export type ConsultationRow = typeof consultations.$inferSelect;

export interface SaveConsultationInput {
	readonly transcript: string;
	readonly anamnesis: Anamnesis;
	readonly engine: string;
	readonly patientId?: number;
	readonly review?: AnamnesisReview | null;
}

export interface AttachAnamnesisInput {
	readonly consultationId: number;
	readonly anamnesis: Anamnesis;
	readonly engine: string;
	readonly patientId?: number;
	readonly review?: AnamnesisReview | null;
}

export interface ConsultationSummary {
	readonly id: number;
	readonly engine: string | null;
	readonly createdAt: Date;
	readonly transcript: string;
	readonly source: string;
	readonly status: string;
	readonly consentAt: Date | null;
	readonly patientName: string | null;
	readonly hasAnamnesis: boolean;
	readonly hasReview: boolean;
	readonly queixa: string | null;
}

export type ConsultationDetail = Omit<ConsultationRow, "anamnesis" | "review"> & {
	readonly patientName: string | null;
	readonly anamnesis: Anamnesis | null;
	readonly review: AnamnesisReview | null;
};

/** Stored JSON columns → typed domain objects, null on any drift. */
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

export async function createConsultation(
	db: DbClient,
	fields: {
		userId: string;
		transcript?: string;
		source: string;
		status?: string;
		botId?: string;
	},
) {
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
export async function appendTranscript(db: DbClient, consultationId: number, text: string) {
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

export async function finishConsultation(db: DbClient, consultationId: number) {
	await db
		.update(consultations)
		.set({ status: "done" })
		.where(eq(consultations.id, consultationId));
}

/** Bot-webhook ownership check: the botId binds consultation ↔ provider session. */
export async function ownsBot(db: DbClient, consultationId: number, botId: string) {
	const rows = await db
		.select({ id: consultations.id })
		.from(consultations)
		.where(and(eq(consultations.id, consultationId), eq(consultations.botId, botId)))
		.limit(1);
	return rows.length > 0;
}

async function saveConsultation(db: DbClient, userId: string, data: SaveConsultationInput) {
	const rows = await db
		.insert(consultations)
		.values({
			userId,
			patientId: data.patientId ?? null,
			transcript: data.transcript,
			anamnesis: JSON.stringify(data.anamnesis),
			engine: data.engine,
			review: data.review ? JSON.stringify(data.review) : null,
			createdAt: new Date(),
		})
		.returning({ id: consultations.id });
	return { id: rows[0]!.id };
}

async function listConsultations(db: DbClient, userId: string): Promise<ConsultationSummary[]> {
	const rows = await db
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
		.where(eq(consultations.userId, userId))
		.orderBy(desc(consultations.id));
	return rows.map(({ anamnesis, review, ...c }) => {
		const parsed = parseStored(anamnesis, decodeAnamnesisOption);
		return {
			...c,
			hasAnamnesis: anamnesis !== null,
			hasReview: review !== null,
			queixa: parsed?.queixa_principal.content ?? null,
		};
	});
}

async function getConsultation(
	db: DbClient,
	id: number,
	userId: string,
): Promise<ConsultationDetail | null> {
	const rows = await db
		.select({ c: consultations, patientName: patients.name })
		.from(consultations)
		.leftJoin(patients, eq(consultations.patientId, patients.id))
		.where(and(eq(consultations.id, id), eq(consultations.userId, userId)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return {
		...row.c,
		patientName: row.patientName,
		anamnesis: parseStored(row.c.anamnesis, decodeAnamnesisOption),
		review: parseStored(row.c.review, decodeAnamnesisReviewOption),
	};
}

async function getLiveConsultation(db: DbClient, id: number, userId: string) {
	const rows = await db
		.select({
			transcript: consultations.transcript,
			status: consultations.status,
		})
		.from(consultations)
		.where(and(eq(consultations.id, id), eq(consultations.userId, userId)))
		.limit(1);
	return rows[0] ?? null;
}

async function attachAnamnesis(db: DbClient, userId: string, data: AttachAnamnesisInput) {
	await db
		.update(consultations)
		.set({
			anamnesis: JSON.stringify(data.anamnesis),
			engine: data.engine,
			review: data.review ? JSON.stringify(data.review) : null,
			patientId: data.patientId ?? null,
			status: "done",
		})
		.where(and(eq(consultations.id, data.consultationId), eq(consultations.userId, userId)));
}

async function recordConsent(db: DbClient, id: number, userId: string) {
	await db
		.update(consultations)
		.set({ consentAt: new Date() })
		.where(and(eq(consultations.id, id), eq(consultations.userId, userId)));
}

/** Consultations domain port — Effect service, swappable in tests. */
export class Consultations extends Context.Service<
	Consultations,
	{
		readonly create: (fields: {
			userId: string;
			transcript?: string;
			source: string;
			status?: string;
			botId?: string;
		}) => Effect.Effect<number | null>;
		readonly appendTranscript: (consultationId: number, text: string) => Effect.Effect<void>;
		readonly finish: (consultationId: number) => Effect.Effect<void>;
		readonly ownedByBot: (consultationId: number, botId: string) => Effect.Effect<boolean>;
		readonly save: (userId: string, input: SaveConsultationInput) => Effect.Effect<{ id: number }>;
		readonly list: (userId: string) => Effect.Effect<ConsultationSummary[]>;
		readonly get: (id: number, userId: string) => Effect.Effect<ConsultationDetail | null>;
		readonly getLive: (
			id: number,
			userId: string,
		) => Effect.Effect<{ transcript: string; status: string } | null>;
		readonly attachAnamnesis: (userId: string, input: AttachAnamnesisInput) => Effect.Effect<void>;
		readonly recordConsent: (id: number, userId: string) => Effect.Effect<void>;
	}
>()("@ktb/consultations/Consultations") {}

export const ConsultationsLive = Layer.effect(
	Consultations,
	Effect.gen(function* () {
		const db = yield* Db;
		return Consultations.of({
			create: (fields) => Effect.promise(() => createConsultation(db, fields)),
			appendTranscript: (id, text) => Effect.promise(() => appendTranscript(db, id, text)),
			finish: (id) => Effect.promise(() => finishConsultation(db, id)),
			ownedByBot: (id, botId) => Effect.promise(() => ownsBot(db, id, botId)),
			save: (userId, input) => Effect.promise(() => saveConsultation(db, userId, input)),
			list: (userId) => Effect.promise(() => listConsultations(db, userId)),
			get: (id, userId) => Effect.promise(() => getConsultation(db, id, userId)),
			getLive: (id, userId) => Effect.promise(() => getLiveConsultation(db, id, userId)),
			attachAnamnesis: (userId, input) => Effect.promise(() => attachAnamnesis(db, userId, input)),
			recordConsent: (id, userId) => Effect.promise(() => recordConsent(db, id, userId)),
		});
	}),
);

export const plugin = definePlugin({
	id: "consultations",
	deps: ["patients"],
	nav: [{ to: "/consultas", label: "Consultas" }],
	tables: { consultations },
	services: ConsultationsLive,
});

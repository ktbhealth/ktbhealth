import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Option } from "effect";
import { and, desc, eq } from "drizzle-orm";
import { index, route } from "@tanstack/virtual-file-routes";

import { Db, type DbClient } from "@ktb/db";
import { definePlugin } from "@ktb/kernel";
import { requireCanAs, requirePrincipalUser, type Forbidden } from "@ktb/authz";
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

/** Owner lookup for authz checks — fetches by id regardless of caller. */
async function consultationOwnerId(db: DbClient, id: number): Promise<string | null> {
	const rows = await db
		.select({ userId: consultations.userId })
		.from(consultations)
		.where(eq(consultations.id, id))
		.limit(1);
	return rows[0]?.userId ?? null;
}

async function getConsultation(db: DbClient, id: number): Promise<ConsultationDetail | null> {
	const rows = await db
		.select({ c: consultations, patientName: patients.name })
		.from(consultations)
		.leftJoin(patients, eq(consultations.patientId, patients.id))
		.where(eq(consultations.id, id))
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

async function getLiveConsultation(db: DbClient, id: number) {
	const rows = await db
		.select({
			transcript: consultations.transcript,
			status: consultations.status,
			userId: consultations.userId,
		})
		.from(consultations)
		.where(eq(consultations.id, id))
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

/**
 * Consultations domain port — Effect service, swappable in tests.
 *
 * User-facing methods (`create`, `save`, `list`, `get`, `getLive`,
 * `attachAnamnesis`, `recordConsent`) enforce authorization against the
 * request `Principal` (@ktb/authz) and fail `Forbidden` for non-owners
 * or when no principal is bound. The bot-channel methods
 * (`appendTranscript`, `finish`, `ownedByBot`) are system paths: they do
 * not consult `Principal` — callers MUST authorize out-of-band first
 * (`ownedByBot` binds botId ↔ consultation before any mutation).
 */
export class Consultations extends Context.Service<
	Consultations,
	{
		readonly create: (fields: {
			userId: string;
			transcript?: string;
			source: string;
			status?: string;
			botId?: string;
		}) => Effect.Effect<number | null, Forbidden>;
		readonly appendTranscript: (consultationId: number, text: string) => Effect.Effect<void>;
		readonly finish: (consultationId: number) => Effect.Effect<void>;
		readonly ownedByBot: (consultationId: number, botId: string) => Effect.Effect<boolean>;
		readonly save: (
			userId: string,
			input: SaveConsultationInput,
		) => Effect.Effect<{ id: number }, Forbidden>;
		readonly list: (userId: string) => Effect.Effect<ConsultationSummary[], Forbidden>;
		readonly get: (
			id: number,
			userId: string,
		) => Effect.Effect<ConsultationDetail | null, Forbidden>;
		readonly getLive: (
			id: number,
			userId: string,
		) => Effect.Effect<{ transcript: string; status: string } | null, Forbidden>;
		readonly attachAnamnesis: (
			userId: string,
			input: AttachAnamnesisInput,
		) => Effect.Effect<void, Forbidden>;
		readonly recordConsent: (id: number, userId: string) => Effect.Effect<void, Forbidden>;
	}
>()("@ktb/consultations/Consultations") {}

export const ConsultationsLive = Layer.effect(
	Consultations,
	Effect.gen(function* () {
		const db = yield* Db;
		return Consultations.of({
			create: Effect.fn("Consultations.create")(function* (fields: {
				userId: string;
				transcript?: string;
				source: string;
				status?: string;
				botId?: string;
			}) {
				yield* requirePrincipalUser(fields.userId, "consultation.create");
				yield* requireCanAs("consultation.create");
				yield* Effect.annotateCurrentSpan({ userId: fields.userId, source: fields.source });
				yield* Effect.logInfo("consultation create", {
					userId: fields.userId,
					source: fields.source,
				});
				return yield* Effect.promise(() => createConsultation(db, fields));
			}),
			appendTranscript: Effect.fn("Consultations.appendTranscript")(function* (
				consultationId: number,
				text: string,
			) {
				yield* Effect.annotateCurrentSpan({ consultationId });
				yield* Effect.logInfo("consultation transcript append", {
					consultationId,
					length: text.length,
				});
				return yield* Effect.promise(() => appendTranscript(db, consultationId, text));
			}),
			finish: Effect.fn("Consultations.finish")(function* (consultationId: number) {
				yield* Effect.annotateCurrentSpan({ consultationId });
				yield* Effect.logInfo("consultation finish", { consultationId });
				return yield* Effect.promise(() => finishConsultation(db, consultationId));
			}),
			ownedByBot: Effect.fn("Consultations.ownedByBot")((consultationId: number, botId: string) =>
				Effect.promise(() => ownsBot(db, consultationId, botId)),
			),
			save: Effect.fn("Consultations.save")(function* (
				userId: string,
				input: SaveConsultationInput,
			) {
				yield* requirePrincipalUser(userId, "consultation.create");
				yield* requireCanAs("consultation.create");
				yield* Effect.annotateCurrentSpan({ userId, engine: input.engine });
				yield* Effect.logInfo("consultation save", { userId, engine: input.engine });
				return yield* Effect.promise(() => saveConsultation(db, userId, input));
			}),
			list: Effect.fn("Consultations.list")(function* (userId: string) {
				yield* requireCanAs("consultation.read", { userId });
				return yield* Effect.promise(() => listConsultations(db, userId));
			}),
			get: Effect.fn("Consultations.get")(function* (id: number, userId: string) {
				yield* requirePrincipalUser(userId, "consultation.read");
				const detail = yield* Effect.promise(() => getConsultation(db, id));
				if (detail === null) return null;
				// permix checks the entity's real owner — a row owned by
				// someone else is Forbidden, not silently null.
				yield* requireCanAs("consultation.read", { userId: detail.userId ?? "" });
				return detail;
			}),
			getLive: Effect.fn("Consultations.getLive")(function* (id: number, userId: string) {
				yield* requirePrincipalUser(userId, "consultation.read");
				const row = yield* Effect.promise(() => getLiveConsultation(db, id));
				if (row === null) return null;
				yield* requireCanAs("consultation.read", { userId: row.userId ?? "" });
				return { transcript: row.transcript, status: row.status };
			}),
			attachAnamnesis: Effect.fn("Consultations.attachAnamnesis")(function* (
				userId: string,
				input: AttachAnamnesisInput,
			) {
				yield* requirePrincipalUser(userId, "consultation.update");
				const owner = yield* Effect.promise(() => consultationOwnerId(db, input.consultationId));
				// Missing row → the UPDATE below is a no-op; nothing to authorize.
				if (owner !== null) {
					yield* requireCanAs("consultation.update", { userId: owner });
				}
				yield* Effect.annotateCurrentSpan({
					userId,
					consultationId: input.consultationId,
					engine: input.engine,
				});
				yield* Effect.logInfo("consultation attach anamnesis", {
					userId,
					consultationId: input.consultationId,
					engine: input.engine,
				});
				return yield* Effect.promise(() => attachAnamnesis(db, userId, input));
			}),
			recordConsent: Effect.fn("Consultations.recordConsent")(function* (
				id: number,
				userId: string,
			) {
				yield* requirePrincipalUser(userId, "consultation.update");
				const owner = yield* Effect.promise(() => consultationOwnerId(db, id));
				if (owner !== null) {
					yield* requireCanAs("consultation.update", { userId: owner });
				}
				yield* Effect.annotateCurrentSpan({ consultationId: id, userId });
				yield* Effect.logInfo("consultation consent recorded", { consultationId: id, userId });
				return yield* Effect.promise(() => recordConsent(db, id, userId));
			}),
		});
	}),
);

export const plugin = definePlugin({
	id: "consultations",
	deps: ["patients"],
	// Route subtree composed into the host's virtualRouteConfig. File paths
	// resolve relative to the host's routes directory (apps/web/src/routes);
	// the route modules there wire these paths to this plugin's views and to
	// host server functions, which plugins cannot import.
	routes: [
		route("consultations", [
			index("consultations/index.tsx"),
			route("$id", "consultations/$id.tsx"),
			route("new", "consultations/new.tsx"),
		]),
	],
	nav: [{ to: "/consultations", label: "Consultas" }],
	tables: { consultations },
	services: ConsultationsLive,
});

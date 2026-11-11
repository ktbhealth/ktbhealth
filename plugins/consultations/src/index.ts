import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { Option } from "effect";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { physical } from "@tanstack/virtual-file-routes";

import { user as users } from "@ktb/auth/schema";
import { Db, type DbClient } from "@ktb/db";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { PlatformAdmin, platformAdminPlugin, platformPanelPlugin } from "@ktb/platform";
import { Forbidden, Principal, requireCanAs, requirePrincipalUser } from "@ktb/authz";
import { ClipboardListIcon } from "lucide-react";
import type { Anamnesis, PatientHistory, PriorVisit } from "@ktb/anamnesis";
import { factContent } from "@ktb/anamnesis";
import { decodeAnamnesisOption } from "@ktb/anamnesis/schema";
import { patients } from "@ktb/patients/schema";
import { patientsServicesPlugin } from "@ktb/patients";
import {
	PatientCascadeCommands,
	PatientRecordConsultationsQueries,
	PatientsCommands,
	PatientsQueries,
} from "@ktb/patients/api";
import { ConsultationAudioUpdated, ConsultationCreated, ConsultationsQueries } from "./api.ts";
import { ConsultationsPlatformPage } from "./platform-page.tsx";
import { Command, EventBus, Query } from "@effect-server-utils/cqrs";
import { consultations } from "./schema.ts";

export type ConsultationRow = typeof consultations.$inferSelect;

export interface SaveConsultationInput {
	readonly transcript: string;
	readonly anamnesis: Anamnesis;
	readonly engine: string;
	readonly patientId?: number;
}

export interface AttachAnamnesisInput {
	readonly consultationId: number;
	readonly anamnesis: Anamnesis;
	readonly engine: string;
	/** Tri-state: undefined keeps the link, null clears it, id re-links. */
	readonly patientId?: number | null;
}

export interface ConsultationSummary {
	readonly id: number;
	readonly engine: string | null;
	readonly createdAt: Date;
	readonly transcript: string;
	readonly source: string;
	readonly status: string;
	readonly consentAt: Date | null;
	readonly patientId: number | null;
	readonly patientName: string | null;
	readonly hasAnamnesis: boolean;
	readonly chiefComplaint: string | null;
}

export type ConsultationDetail = Omit<ConsultationRow, "anamnesis" | "review"> & {
	readonly patientName: string | null;
	readonly anamnesis: Anamnesis | null;
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

// ---------- audio pipeline (system paths — queue consumer, no principal) ----------

export interface AudioJobFields {
	readonly audioKey: string;
	readonly contentType?: string;
	readonly size?: number;
}

/** Status the owner-facing routes may set after enqueue; terminal states are consumer-only. */
export const AUDIO_ROUTE_STATUSES = ["queued"] as const;
export type AudioRouteStatus = (typeof AUDIO_ROUTE_STATUSES)[number];

/** Record the R2 object link after a successful upload (status "stored"). */
export async function attachAudioRecord(
	db: DbClient,
	consultationId: number,
	fields: AudioJobFields,
) {
	await db
		.update(consultations)
		.set({
			audioKey: fields.audioKey,
			audioStatus: "stored",
			audioContentType: fields.contentType ?? null,
			audioSize: fields.size ?? null,
			audioError: null,
		})
		.where(eq(consultations.id, consultationId));
}

/** stored → queued once the transcription job was enqueued. */
export async function markAudioQueued(db: DbClient, consultationId: number) {
	await db
		.update(consultations)
		.set({ audioStatus: "queued", audioError: null })
		.where(eq(consultations.id, consultationId));
}

export interface AudioJobRecord {
	readonly audioKey: string | null;
	readonly audioStatus: string;
	readonly userId: string | null;
}

/** Consumer lookup: fetch the audio linkage regardless of caller. */
export async function audioJobRecord(
	db: DbClient,
	consultationId: number,
): Promise<AudioJobRecord | null> {
	const rows = await db
		.select({
			audioKey: consultations.audioKey,
			audioStatus: consultations.audioStatus,
			userId: consultations.userId,
		})
		.from(consultations)
		.where(eq(consultations.id, consultationId))
		.limit(1);
	return rows[0] ?? null;
}

export async function beginAudioJob(db: DbClient, consultationId: number) {
	await db
		.update(consultations)
		.set({ audioStatus: "processing", audioError: null })
		.where(eq(consultations.id, consultationId));
}

/** Server transcript persisted — the raw ASR evidence. */
export async function completeAudioJob(db: DbClient, consultationId: number, transcript: string) {
	await db
		.update(consultations)
		.set({ serverTranscript: transcript, audioStatus: "done", audioError: null })
		.where(eq(consultations.id, consultationId));
}

export async function failAudioJob(db: DbClient, consultationId: number, reason: string) {
	await db
		.update(consultations)
		.set({ audioStatus: "failed", audioError: reason })
		.where(eq(consultations.id, consultationId));
}

/**
 * LLM-cleaned transcript alongside the original — never overwrites
 * serverTranscript. Status stays "done"; correctedTranscript stays null
 * when no LLM is configured or the call fails.
 */
export async function saveCorrectedTranscript(
	db: DbClient,
	consultationId: number,
	corrected: string,
	engine: string,
) {
	await db
		.update(consultations)
		.set({ correctedTranscript: corrected, enhancementEngine: engine })
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
			createdAt: new Date(),
		})
		.returning({ id: consultations.id });
	return { id: rows[0]!.id };
}

/** Every consultation linked to a patient, whoever owns it — authz happens in the service. */
async function patientConsultationRows(db: DbClient, patientId: number) {
	return db
		.select({
			id: consultations.id,
			userId: consultations.userId,
			audioKey: consultations.audioKey,
		})
		.from(consultations)
		.where(eq(consultations.patientId, patientId));
}

/** Linked consultation rows only — the patient row itself goes through
 * the `patients.delete` command (authz + `patient.deleted` event live
 * in the patients plugin). Consultations are deleted first so a FK
 * constraint can't block the patient delete. The select stays
 * owner-agnostic on purpose: the service scans EVERY linked row and
 * fails `Forbidden` on a foreign one — that check is what keeps a
 * stray cross-owner link from silently surviving (or blocking) the
 * patient delete via the FK. */
async function deletePatientConsultations(db: DbClient, patientId: number, userId: string) {
	await db
		.delete(consultations)
		.where(and(eq(consultations.patientId, patientId), eq(consultations.userId, userId)));
}

async function listConsultations(
	db: DbClient,
	userId: string,
	patientId?: number,
): Promise<ConsultationSummary[]> {
	const where =
		patientId === undefined
			? eq(consultations.userId, userId)
			: and(eq(consultations.userId, userId), eq(consultations.patientId, patientId));
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
			patientId: consultations.patientId,
			patientName: patients.name,
		})
		.from(consultations)
		.leftJoin(patients, eq(consultations.patientId, patients.id))
		.where(where)
		.orderBy(desc(consultations.id));
	return rows.map(({ anamnesis, ...c }) => {
		const parsed = parseStored(anamnesis, decodeAnamnesisOption);
		return {
			...c,
			hasAnamnesis: anamnesis !== null,
			chiefComplaint: parsed?.queixa_principal.content ?? null,
		};
	});
}

/** Admin-console row: consultation plus owner/patient display fields. */
export interface AdminConsultationRow extends ConsultationRow {
	readonly ownerEmail: string | null;
	readonly ownerName: string | null;
	readonly patientName: string | null;
}

/**
 * Cross-owner listing for the /platform console. Callers MUST have
 * passed the `PlatformAdmin` gate first — this repo function itself is
 * unauthenticated, like the other helpers.
 */
export async function listAllConsultations(db: DbClient): Promise<AdminConsultationRow[]> {
	const rows = await db
		.select({
			consultation: consultations,
			ownerEmail: users.email,
			ownerName: users.name,
			patientName: patients.name,
		})
		.from(consultations)
		.leftJoin(users, eq(consultations.userId, users.id))
		.leftJoin(patients, eq(consultations.patientId, patients.id))
		.orderBy(desc(consultations.id));
	return rows.map(({ consultation, ownerEmail, ownerName, patientName }) => ({
		...consultation,
		ownerEmail,
		ownerName,
		patientName,
	}));
}

/** Row shape behind the `consultations.audioJobs` query — the minimal
 * audio-pipeline projection the /platform jobs feed maps. */
export interface AudioJobRow {
	readonly id: number;
	readonly audioStatus: string;
	readonly audioError: string | null;
	readonly createdAt: Date;
	readonly patientName: string | null;
}

/**
 * Cross-owner audio-pipeline listing for the /platform jobs feed.
 * Callers MUST have passed the `PlatformAdmin` gate first — this repo
 * function itself is unauthenticated, like `listAllConsultations`.
 */
export async function listAudioJobRows(db: DbClient): Promise<AudioJobRow[]> {
	return db
		.select({
			id: consultations.id,
			audioStatus: consultations.audioStatus,
			audioError: consultations.audioError,
			createdAt: consultations.createdAt,
			patientName: patients.name,
		})
		.from(consultations)
		.leftJoin(patients, eq(consultations.patientId, patients.id))
		.orderBy(desc(consultations.id));
}

/** Single-row variant of `listAudioJobRows` — the live-delta lookup the
 * `consultation.audioUpdated` subscriber re-reads after each event. */
export async function audioJobRow(
	db: DbClient,
	consultationId: number,
): Promise<AudioJobRow | null> {
	const rows = await db
		.select({
			id: consultations.id,
			audioStatus: consultations.audioStatus,
			audioError: consultations.audioError,
			createdAt: consultations.createdAt,
			patientName: patients.name,
		})
		.from(consultations)
		.leftJoin(patients, eq(consultations.patientId, patients.id))
		.where(eq(consultations.id, consultationId))
		.limit(1);
	return rows[0] ?? null;
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
	// patientId is tri-state: undefined leaves the column untouched,
	// null clears the link, a number re-links (ownership already checked
	// by the service).
	const set: {
		anamnesis: string;
		engine: string;
		status: string;
		patientId?: number | null;
	} = {
		anamnesis: JSON.stringify(data.anamnesis),
		engine: data.engine,
		status: "done",
	};
	if (data.patientId === null) set.patientId = null;
	else if (data.patientId !== undefined) set.patientId = data.patientId;
	await db
		.update(consultations)
		.set(set)
		.where(and(eq(consultations.id, data.consultationId), eq(consultations.userId, userId)));
}

async function recordConsent(db: DbClient, id: number, userId: string) {
	await db
		.update(consultations)
		.set({ consentAt: new Date() })
		.where(and(eq(consultations.id, id), eq(consultations.userId, userId)));
}

/** How many prior consultations feed the history summary. */
export const HISTORY_LIMIT = 3;

/**
 * Factual history of a patient's consultations, scoped to the calling
 * doctor (consultations.userId) and to patients they own. Live sessions
 * and `excludeId` (the consultation being viewed) are skipped. Returns
 * null when the patient is not owned by `userId`.
 */
async function patientHistory(
	db: DbClient,
	patientId: number,
	userId: string,
	excludeId?: number,
): Promise<PatientHistory | null> {
	const owner = await db
		.select({ id: patients.id })
		.from(patients)
		.where(and(eq(patients.id, patientId), eq(patients.ownerId, userId)))
		.limit(1);
	if (!owner[0]) return null;
	const conds = [
		eq(consultations.patientId, patientId),
		eq(consultations.userId, userId),
		ne(consultations.status, "live"),
	];
	if (excludeId !== undefined) conds.push(ne(consultations.id, excludeId));
	const where = and(...conds);
	const countRows = await db.select({ n: count() }).from(consultations).where(where);
	const rows = await db
		.select({
			id: consultations.id,
			createdAt: consultations.createdAt,
			anamnesis: consultations.anamnesis,
		})
		.from(consultations)
		.where(where)
		.orderBy(desc(consultations.id))
		.limit(HISTORY_LIMIT);
	const visits: PriorVisit[] = rows.map((row) => {
		const parsed = parseStored(row.anamnesis, decodeAnamnesisOption);
		return {
			id: row.id,
			date: row.createdAt.toISOString(),
			chiefComplaint: factContent(parsed?.queixa_principal.content),
			plan: factContent(parsed?.conduta.content),
		};
	});
	return { count: countRows[0]!.n, visits };
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
		/** Owner's consultations, optionally only those linked to `patientId`. */
		readonly list: (
			userId: string,
			patientId?: number,
		) => Effect.Effect<ConsultationSummary[], Forbidden>;
		/** Cross-owner listing for the /platform console — platform admins only. */
		readonly adminList: () => Effect.Effect<AdminConsultationRow[], Forbidden>;
		/**
		 * Live feed of the audio-pipeline projection behind the /platform
		 * jobs popover: replays the current rows (same shape as the
		 * `consultations.audioJobs` query), then emits one fresh row per
		 * `consultation.audioUpdated` event. Platform admins only.
		 */
		readonly audioJobsStream: () => Stream.Stream<AudioJobRow, Forbidden>;
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
		/** Link a stored R2 audio object to the consultation (status "stored"). */
		readonly attachAudio: (
			userId: string,
			input: { consultationId: number } & AudioJobFields,
		) => Effect.Effect<void, Forbidden>;
		/** Owner-facing status transition (stored | queued only). */
		readonly updateAudioStatus: (
			userId: string,
			consultationId: number,
			status: AudioRouteStatus,
		) => Effect.Effect<void, Forbidden>;
		readonly history: (
			patientId: number,
			userId: string,
			excludeId?: number,
		) => Effect.Effect<PatientHistory | null, Forbidden>;
		/**
		 * Delete a patient together with every consultation linked to them
		 * (transcripts, anamneses), atomically. Owner-only on the patient and
		 * on each consultation. Returns null when the patient does not exist,
		 * otherwise how many consultations went and the R2 audio keys the
		 * caller must purge (storage is outside the database).
		 */
		readonly deletePatient: (
			userId: string,
			patientId: number,
		) => Effect.Effect<{ consultations: number; audioKeys: string[] } | null, Forbidden>;
	}
>()("@ktb/consultations/Consultations") {}

export const ConsultationsLive = Layer.effect(
	Consultations,
	Effect.gen(function* () {
		const db = yield* Db;
		const platformAdmin = yield* PlatformAdmin;
		const patientQueries = yield* Query.dispatcher(PatientsQueries);
		const patientCommands = yield* Command.dispatcher(PatientsCommands);
		const events = yield* EventBus;
		// Live fan-out for audioJobsStream: every audio-status mutation
		// (service methods here, the queue consumer via the host) publishes
		// ConsultationAudioUpdated; the handler re-reads the row so stream
		// consumers always get the full projection, never a partial payload.
		const liveAudioJobs = yield* PubSub.unbounded<AudioJobRow>();
		// Patient-link guard for save/attach: a patientId must resolve to
		// a patient the acting user owns (patients.ownerOf is the
		// cross-plugin lookup). Foreign or missing ids fail `Forbidden` —
		// same denial shape as a failed permix check, so callers can't
		// probe which patient ids exist.
		const requireOwnedPatient = (patientId: number, path: string) =>
			Effect.gen(function* () {
				const owner = yield* patientQueries["patients.ownerOf"]({ id: patientId });
				if (owner === null) return yield* Effect.fail(new Forbidden({ path }));
				yield* requireCanAs("patient.read", { ownerId: owner.ownerId });
			});
		yield* events.subscribeAfterCommit(ConsultationAudioUpdated, (event) =>
			Effect.gen(function* () {
				const row = yield* Effect.promise(() => audioJobRow(db, event.consultationId));
				// Missing row (deleted consultation) → nothing to emit; the
				// client's seeded copy survives until the next loader pass.
				if (row !== null) yield* PubSub.publish(liveAudioJobs, row);
			}),
		);
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
				const id = yield* Effect.promise(() => createConsultation(db, fields));
				if (id !== null) {
					yield* events.dispatch([
						ConsultationCreated.make({
							id,
							userId: fields.userId,
							source: fields.source,
						}),
					]);
				}
				return id;
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
				if (input.patientId !== undefined) {
					yield* requireOwnedPatient(input.patientId, "patient.read");
				}
				yield* Effect.annotateCurrentSpan({ userId, engine: input.engine });
				yield* Effect.logInfo("consultation save", { userId, engine: input.engine });
				return yield* Effect.promise(() => saveConsultation(db, userId, input));
			}),
			list: Effect.fn("Consultations.list")(function* (userId: string, patientId?: number) {
				yield* requireCanAs("consultation.read", { userId });
				return yield* Effect.promise(() => listConsultations(db, userId, patientId));
			}),
			adminList: Effect.fn("Consultations.adminList")(function* () {
				// Platform gate first — fails Forbidden for non-admins and
				// for system contexts (null principal) alike.
				yield* platformAdmin.requireAdmin();
				yield* Effect.annotateCurrentSpan({ adminList: true });
				yield* Effect.logInfo("consultations admin list");
				return yield* Effect.promise(() => listAllConsultations(db));
			}),
			audioJobsStream: () =>
				Stream.unwrap(
					Effect.gen(function* () {
						// Same gate as adminList — fails Forbidden for
						// non-admins and for system contexts (null principal).
						yield* platformAdmin.requireAdmin();
						// Backlog first, then live deltas. The backlog read
						// happens inside the stream's first effect so
						// construction stays cheap and authz is enforced on pull.
						const rows = yield* Effect.promise(() => listAudioJobRows(db));
						return Stream.concat(Stream.fromIterable(rows), Stream.fromPubSub(liveAudioJobs));
					}),
				),
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
				// Re-linking to a patient requires owning that patient;
				// null (clear) and undefined (keep) skip the lookup.
				if (typeof input.patientId === "number") {
					yield* requireOwnedPatient(input.patientId, "patient.read");
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
			attachAudio: Effect.fn("Consultations.attachAudio")(function* (
				userId: string,
				input: { consultationId: number } & AudioJobFields,
			) {
				yield* requirePrincipalUser(userId, "consultation.update");
				const owner = yield* Effect.promise(() => consultationOwnerId(db, input.consultationId));
				if (owner !== null) {
					yield* requireCanAs("consultation.update", { userId: owner });
				}
				yield* Effect.annotateCurrentSpan({
					userId,
					consultationId: input.consultationId,
					audioKey: input.audioKey,
				});
				yield* Effect.logInfo("consultation audio attached", {
					userId,
					consultationId: input.consultationId,
				});
				yield* Effect.promise(() => attachAudioRecord(db, input.consultationId, input));
				yield* events.dispatch([
					ConsultationAudioUpdated.make({
						consultationId: input.consultationId,
						audioStatus: "stored",
						audioError: null,
					}),
				]);
			}),
			updateAudioStatus: Effect.fn("Consultations.updateAudioStatus")(function* (
				userId: string,
				consultationId: number,
				status: AudioRouteStatus,
			) {
				yield* requirePrincipalUser(userId, "consultation.update");
				const owner = yield* Effect.promise(() => consultationOwnerId(db, consultationId));
				if (owner !== null) {
					yield* requireCanAs("consultation.update", { userId: owner });
				}
				yield* Effect.annotateCurrentSpan({ userId, consultationId, audioStatus: status });
				yield* Effect.promise(() => markAudioQueued(db, consultationId));
				yield* events.dispatch([
					ConsultationAudioUpdated.make({
						consultationId,
						audioStatus: "queued",
						audioError: null,
					}),
				]);
			}),
			history: Effect.fn("Consultations.history")(function* (
				patientId: number,
				userId: string,
				excludeId?: number,
			) {
				yield* requireCanAs("consultation.read", { userId });
				return yield* Effect.promise(() => patientHistory(db, patientId, userId, excludeId));
			}),
			deletePatient: Effect.fn("Consultations.deletePatient")(function* (
				userId: string,
				patientId: number,
			) {
				yield* requirePrincipalUser(userId, "patient.delete");
				// Missing patient → null, same contract as before. The
				// `patients.delete` command below owns patient authz + the
				// row delete; it runs in this fiber so Principal/Db/EventBus
				// flow through.
				const owner = yield* patientQueries["patients.ownerOf"]({ id: patientId });
				if (owner === null) return null;
				const rows = yield* Effect.promise(() => patientConsultationRows(db, patientId));
				// Any consultation owned by someone else blocks the whole cascade.
				for (const row of rows)
					yield* requireCanAs("consultation.delete", { userId: row.userId ?? "" });
				yield* Effect.annotateCurrentSpan({ userId, patientId, consultations: rows.length });
				yield* Effect.logInfo("patient deleted with consultations", {
					userId,
					patientId,
					consultations: rows.length,
				});
				yield* Effect.promise(() => deletePatientConsultations(db, patientId, userId));
				yield* patientCommands["patients.delete"]({ id: patientId });
				return {
					consultations: rows.length,
					audioKeys: rows.flatMap((r) => (r.audioKey ? [r.audioKey] : [])),
				};
			}),
		});
	}),
);

export const consultationsTablesPlugin = definePlugin({
	id: "consultations.tables",
	tables: { consultations },
});

/** Cross-plugin query surface — registered so other plugins can
 * `Query.dispatcher(ConsultationsQueries)` against it. */
export const ConsultationsQueriesLive = Query.handlersOf(ConsultationsQueries, {
	"consultations.forPatient": ({ patientId }) =>
		Effect.gen(function* () {
			const db = yield* Db;
			return yield* Effect.promise(() =>
				db
					.select({
						id: consultations.id,
						status: consultations.status,
						createdAt: consultations.createdAt,
					})
					.from(consultations)
					.where(eq(consultations.patientId, patientId)),
			);
		}),
	// Cross-owner read — same gate as `Consultations.adminList`: the
	// platform-admin check fails Forbidden for non-admins and for
	// system contexts (null principal) alike.
	"consultations.audioJobs": () =>
		Effect.gen(function* () {
			const platformAdmin = yield* PlatformAdmin;
			yield* platformAdmin.requireAdmin();
			const db = yield* Db;
			return yield* Effect.promise(() => listAudioJobRows(db));
		}),
});

/**
 * `patients.*` CQRS surface owned by this plugin (P-033): the patients
 * plugin's server functions dispatch these groups; the defs live in
 * @ktb/patients/api so patients never imports @ktb/consultations.
 * Handlers reuse the same authz + row helpers as the Consultations
 * service methods they mirror.
 */
export const PatientRecordConsultationsLive = Query.handlersOf(PatientRecordConsultationsQueries, {
	"patients.recordConsultations": ({ patientId }) =>
		Effect.gen(function* () {
			const principal = yield* Principal;
			if (principal === null) return yield* Effect.fail(new Forbidden({ path: "principal" }));
			const db = yield* Db;
			// Same gate as Consultations.list — owner-scoped read.
			yield* requireCanAs("consultation.read", { userId: principal.userId });
			const rows = yield* Effect.promise(() => listConsultations(db, principal.userId, patientId));
			return rows.map((r) => ({
				id: r.id,
				// Rows are filtered by patientId (the column is nullable in the
				// schema but never null here), so it is the requested id.
				patientId,
				createdAt: r.createdAt,
				status: r.status,
				hasAnamnesis: r.hasAnamnesis,
				chiefComplaint: r.chiefComplaint,
			}));
		}),
});

export const PatientDeleteCascadeLive = Command.handlersOf(PatientCascadeCommands, {
	"patients.deleteCascade": ({ patientId }) =>
		Effect.gen(function* () {
			const principal = yield* Principal;
			if (principal === null) return yield* Effect.fail(new Forbidden({ path: "principal" }));
			const db = yield* Db;
			const patientQueries = yield* Query.dispatcher(PatientsQueries);
			const patientCommands = yield* Command.dispatcher(PatientsCommands);
			// Mirrors Consultations.deletePatient — the caller is the bound
			// Principal (no userId param to cross-check), so the flow is:
			// patient owner lookup → per-consultation authz → cascade →
			// `patients.delete` (which owns patient authz + the row delete).
			const owner = yield* patientQueries["patients.ownerOf"]({ id: patientId });
			if (owner === null) return null;
			const rows = yield* Effect.promise(() => patientConsultationRows(db, patientId));
			for (const row of rows)
				yield* requireCanAs("consultation.delete", { userId: row.userId ?? "" });
			// Every row passed the per-row authz above, so all survivors
			// are principal-owned — the delete is scoped to them anyway.
			yield* Effect.promise(() => deletePatientConsultations(db, patientId, principal.userId));
			yield* patientCommands["patients.delete"]({ id: patientId });
			return {
				consultations: rows.length,
				audioKeys: rows.flatMap((r) => (r.audioKey ? [r.audioKey] : [])),
			};
		}),
});

export const consultationsServicesPlugin = definePlugin({
	id: "consultations.services",
	requiredDeps: [patientsServicesPlugin.id, platformAdminPlugin.id],
	services: Layer.mergeAll(
		ConsultationsLive,
		ConsultationsQueriesLive,
		PatientRecordConsultationsLive,
		PatientDeleteCascadeLive,
	),
});

// Route subtree composed into the host's virtualRouteConfig (P-033):
// the route modules live in THIS package (src/routes/**) and are
// discovered by a physical() directory scan. The directory path is
// resolved relative to the host's routes directory
// (apps/web/src/routes) — "../../../../" escapes to the repo root —
// and the modules reach the app runtime through @ktb/server-fns, so
// the plugin owns routes end to end with zero host route files.
export const consultationsRoutesPlugin = definePlugin({
	id: "consultations.routes",
	routes: [
		physical("/consultations", "../../../../plugins/consultations/src/routes"),
		// API subtree: /api/consultations/:id/{audio,pdf}, /api/transcribe and
		// /api/patients/:id/export — owner-only record/audio/export endpoints.
		// Route modules must live directly in src/api-routes/ — the generator
		// scans every file in the mounted directory.
		physical("/api", "../../../../plugins/consultations/src/api-routes"),
	],
});

export const consultationsLandingNavPlugin = definePlugin({
	id: "consultations.landing-nav",
	landingNav: [{ to: "/consultations", label: "Consultations" }],
});

// Panel (system console) contribution: /platform/consultations is
// mounted by the platform plugin's physical route subtree; this plugin
// only declares the sidebar entry. The dep edge orders it after the
// platform shell.
export const consultationsPanelPlugin = definePlugin({
	id: "consultations.panel",
	requiredDeps: [platformPanelPlugin.id],
	panel: {
		sidebar: [
			{
				to: "/platform/consultations",
				label: "Consultations",
				icon: ClipboardListIcon,
				group: "Domains",
			},
		],
		pages: [
			{
				id: "consultations.admin",
				path: "/platform/consultations",
				component: ConsultationsPlatformPage,
				// Cross-owner listing for the console — the service
				// re-checks the PlatformAdmin gate; Forbidden collapses
				// to the same empty table the old server fn returned.
				loader: () =>
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						return yield* consultations
							.adminList()
							.pipe(
								Effect.catchTag("Forbidden", () => Effect.succeed([] as AdminConsultationRow[])),
							);
					}),
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	consultationsTablesPlugin,
	consultationsServicesPlugin,
	consultationsRoutesPlugin,
	consultationsLandingNavPlugin,
	consultationsPanelPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"consultations.tables": true;
		"consultations.services": true;
		"consultations.routes": true;
		"consultations.landing-nav": true;
		"consultations.panel": true;
	}
}

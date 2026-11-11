import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { Db, makeDb } from "@ktb/db";
import { user as userTable } from "@ktb/db/schema";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import { patients as patientsTable } from "@ktb/patients/schema";
import {
	Patients,
	patientsServicesPlugin,
	PatientsCommandsLive,
	PatientsQueriesLive,
} from "@ktb/patients";
import { EventBus, type EventBusShape, makeEventBus, Query } from "@effect-server-utils/cqrs";
import { Tenant, type Tenant as TenantScope } from "@ktb/tenant";
import {
	makePlatformAdminGate,
	parsePlatformAdminEmails,
	PlatformAdmin,
	platformAdminPlugin,
	platformPanelPlugin,
} from "@ktb/platform";
import { ClipboardListIcon } from "lucide-react";
import { consultations as consultationsTable } from "./schema.ts";
import { ConsultationAudioUpdated, ConsultationsQueries } from "./api.ts";
import {
	Consultations,
	ConsultationsLive,
	ConsultationsQueriesLive,
	appendTranscript,
	attachAudioRecord,
	audioJobRecord,
	beginAudioJob,
	completeAudioJob,
	consultationsLandingNavPlugin,
	consultationsPanelPlugin,
	consultationsRoutesPlugin,
	consultationsServicesPlugin,
	consultationsTablesPlugin,
	createConsultation,
	failAudioJob,
	finishConsultation,
	listAllConsultations,
	markAudioQueued,
	ownsBot,
	plugins,
	saveCorrectedTranscript,
	type SaveConsultationInput,
} from "./index.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" (id, name, email, email_verified, image, banned, created_at, updated_at) VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER, tenant_id INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL, tenant_id INTEGER);
`;

// ConsultationsLive requires PlatformAdmin (adminList) — every runtime
// below provides the same allowlisted gate.
const liveDeps = (
	db: ReturnType<typeof makeDb>,
	eventBus: Layer.Layer<EventBus> = makeEventBus(),
) => {
	const infra = Layer.mergeAll(
		Layer.succeed(Db, db),
		Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		eventBus,
	);
	return Layer.mergeAll(
		infra,
		// ConsultationsLive dispatches `patients.ownerOf` / `patients.delete`
		// — register the real handlers against the test db (same impls the
		// patients plugin ships).
		Layer.mergeAll(PatientsQueriesLive, PatientsCommandsLive).pipe(Layer.provide(infra)),
	);
};

describe("consultations repo", () => {
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("creates with defaults", async () => {
		const id = await createConsultation(db, { userId: "u1", source: "browser" });
		expect(id).toBeTypeOf("number");
	});

	it("appendTranscript concatenates chunks", async () => {
		const id = await createConsultation(db, {
			userId: "u1",
			transcript: "one",
			source: "bot",
		});
		await appendTranscript(db, id!, "two");
		await appendTranscript(db, id!, "three");
		const { consultations } = await import("./schema.ts");
		const { eq } = await import("drizzle-orm");
		const rows = await db
			.select({ t: consultations.transcript })
			.from(consultations)
			.where(eq(consultations.id, id!));
		expect(rows[0]!.t).toBe("one\ntwo\nthree");
	});

	it("finishConsultation marks done", async () => {
		const id = await createConsultation(db, {
			userId: "u1",
			source: "live",
			status: "live",
		});
		await finishConsultation(db, id!);
		const { consultations } = await import("./schema.ts");
		const { eq } = await import("drizzle-orm");
		const rows = await db
			.select({ s: consultations.status })
			.from(consultations)
			.where(eq(consultations.id, id!));
		expect(rows[0]!.s).toBe("done");
	});

	it("appendTranscript on missing row uses empty base", async () => {
		await appendTranscript(db, 9999, "orphan");
	});

	it("ownsBot matches consultation by botId", async () => {
		const id = await createConsultation(db, {
			userId: "u1",
			source: "bot",
			status: "live",
			botId: "bot-1",
		});
		expect(await ownsBot(db, id!, "bot-1")).toBe(true);
		expect(await ownsBot(db, id!, "other-bot")).toBe(false);
		expect(await ownsBot(db, 9999, "bot-1")).toBe(false);
	});

	it("createConsultation returns null when insert yields no row", async () => {
		const stub = {
			insert: () => ({
				values: () => ({ returning: async () => [] }),
			}),
		} as unknown as typeof db;
		expect(await createConsultation(stub, { userId: "u1", source: "browser" })).toBeNull();
	});

	it("listAllConsultations returns cross-owner rows with owner and patient fields", async () => {
		const [p] = await db
			.insert(patientsTable)
			.values({ ownerId: "u1", name: "Repo Paciente", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		const id = await createConsultation(db, { userId: "u1", source: "browser" });
		await db
			.update(consultationsTable)
			.set({ patientId: p!.id })
			.where(eq(consultationsTable.id, id!));
		const rows = await listAllConsultations(db);
		const row = rows.find((r) => r.id === id);
		expect(row?.ownerEmail).toBe("d@x.com");
		expect(row?.ownerName).toBe("Dra");
		expect(row?.patientName).toBe("Repo Paciente");
		// Newest first.
		expect(rows[0]?.id).toBeGreaterThanOrEqual(rows.at(-1)?.id ?? 0);
	});
});

describe("ConsultationsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Consultations, never>;
	let testDb: ReturnType<typeof makeDb>;

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Consultations>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const call = <A, E>(f: (c: Consultations["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Consultations, f);

	const saveInput = (over: Partial<SaveConsultationInput> = {}): SaveConsultationInput => ({
		transcript: "t",
		anamnesis: {} as SaveConsultationInput["anamnesis"],
		engine: "e",
		...over,
	});

	beforeAll(() => {
		testDb = makeDb(makeD1(DDL));
		runtime = ManagedRuntime.make(ConsultationsLive.pipe(Layer.provide(liveDeps(testDb))));
	});

	afterAll(() => runtime.dispose());

	it("bot-channel methods run without a principal (system path)", async () => {
		const id = await createConsultation(testDb, {
			userId: "u1",
			source: "bot",
			botId: "svc-bot",
		});
		await runtime.runPromise(
			Effect.gen(function* () {
				const c = yield* Consultations;
				yield* c.appendTranscript(id!, "svc chunk");
				yield* c.finish(id!);
				expect(yield* c.ownedByBot(id!, "svc-bot")).toBe(true);
				expect(yield* c.ownedByBot(id!, "nope")).toBe(false);
			}),
		);
	});

	it("create/save enforce the bound principal", async () => {
		const id = await asUser(
			"u1",
			call((c) => c.create({ userId: "u1", source: "browser", botId: "b1" })),
		);
		expect(id).toBeTypeOf("number");

		const saved = await asUser(
			"u1",
			call((c) => c.save("u1", saveInput())),
		);
		expect(saved.id).toBeGreaterThan(0);

		await expect(
			asUser(
				"u1",
				call((c) => c.create({ userId: "u2", source: "browser" })),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "consultation.create" });
		await expect(
			asUser(
				"u1",
				call((c) => c.save("u2", saveInput())),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
		await expect(
			asUser(
				null,
				call((c) => c.create({ userId: "u1", source: "browser" })),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				null,
				call((c) => c.save("u1", saveInput())),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
	});

	it("list/get/getLive are owner-scoped via permix", async () => {
		const id = await asUser(
			"u1",
			call((c) => c.create({ userId: "u1", transcript: "live text", source: "mic" })),
		);

		const list = await asUser(
			"u1",
			call((c) => c.list("u1")),
		);
		expect(list.some((c) => c.id === id)).toBe(true);
		await expect(
			asUser(
				"u1",
				call((c) => c.list("u2")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
		await expect(
			asUser(
				null,
				call((c) => c.list("u1")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});

		const detail = await asUser(
			"u1",
			call((c) => c.get(id!, "u1")),
		);
		expect(detail?.userId).toBe("u1");
		expect(
			await asUser(
				"u1",
				call((c) => c.get(9999, "u1")),
			),
		).toBeNull();
		await expect(
			asUser(
				"u2",
				call((c) => c.get(id!, "u2")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
		await expect(
			asUser(
				null,
				call((c) => c.get(id!, "u1")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});

		const live = await asUser(
			"u1",
			call((c) => c.getLive(id!, "u1")),
		);
		expect(live).toEqual({ transcript: "live text", status: "done" });
		expect(
			await asUser(
				"u1",
				call((c) => c.getLive(9999, "u1")),
			),
		).toBeNull();
		await expect(
			asUser(
				"u2",
				call((c) => c.getLive(id!, "u2")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
	});

	it("adminList returns cross-owner rows for an allowlisted principal", async () => {
		const rows = await asUser(
			"u1",
			call((c) => c.adminList()),
			"admin@x.com",
		);
		expect(rows.length).toBeGreaterThan(0);
		// Fixture consultations are u1-owned; the join resolves the
		// owner's email — proof adminList is not owner-scoped.
		expect(rows.every((r) => r.ownerEmail === "d@x.com")).toBe(true);
	});

	it("adminList fails Forbidden for non-admin email, missing email and null principal", async () => {
		await expect(
			asUser(
				"u1",
				call((c) => c.adminList()),
				"other@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
		await expect(
			asUser(
				"u1",
				call((c) => c.adminList()),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				null,
				call((c) => c.adminList()),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("adminCreate inserts a consultation for another owner", async () => {
		await testDb.insert(userTable).values({
			id: "u2",
			name: "Dr B",
			email: "b@x.com",
			emailVerified: false,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});
		const id = await asUser(
			"u1",
			call((c) => c.adminCreate({ userId: "u2", transcript: "admin note", source: "manual" })),
			"admin@x.com",
		);
		expect(id).not.toBeNull();
		const rows = await testDb
			.select()
			.from(consultationsTable)
			.where(eq(consultationsTable.id, id!));
		expect(rows[0]).toMatchObject({ userId: "u2", transcript: "admin note", source: "manual" });
	});

	it("adminCreate links an existing patient and rejects unknown ones", async () => {
		const [patient] = await testDb
			.insert(patientsTable)
			.values({ ownerId: "u1", name: "Pat", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		const id = await asUser(
			"u1",
			call((c) => c.adminCreate({ userId: "u2", patientId: patient!.id, source: "manual" })),
			"admin@x.com",
		);
		const rows = await testDb
			.select({ patientId: consultationsTable.patientId })
			.from(consultationsTable)
			.where(eq(consultationsTable.id, id!));
		expect(rows[0]?.patientId).toBe(patient!.id);

		await expect(
			asUser(
				"u1",
				call((c) => c.adminCreate({ userId: "u2", patientId: 999999, source: "manual" })),
				"admin@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "patientId" });
	});

	it("adminCreate fails Forbidden for non-admin and null principal", async () => {
		await expect(
			asUser(
				"u1",
				call((c) => c.adminCreate({ userId: "u2", source: "manual" })),
				"other@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
		await expect(
			asUser(
				null,
				call((c) => c.adminCreate({ userId: "u2", source: "manual" })),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("adminDelete removes the row and returns its audio key", async () => {
		const id = await createConsultation(testDb, {
			userId: "u1",
			source: "mic",
			patientId: undefined,
		});
		await testDb
			.update(consultationsTable)
			.set({ audioKey: "audios/x.webm" })
			.where(eq(consultationsTable.id, id!));
		const result = await asUser(
			"u1",
			call((c) => c.adminDelete(id!)),
			"admin@x.com",
		);
		expect(result).toEqual({ audioKey: "audios/x.webm" });
		const rows = await testDb
			.select({ id: consultationsTable.id })
			.from(consultationsTable)
			.where(eq(consultationsTable.id, id!));
		expect(rows).toEqual([]);
	});

	it("adminCreate returns null when the insert yields no row", async () => {
		const stub = {
			insert: () => ({ values: () => ({ returning: async () => [] }) }),
		} as unknown as ReturnType<typeof makeDb>;
		const runtime = ManagedRuntime.make(ConsultationsLive.pipe(Layer.provide(liveDeps(stub))));
		try {
			const id = await runtime.runPromise(
				Effect.provideService(
					Effect.flatMap(Consultations, (c) => c.adminCreate({ userId: "u2", source: "manual" })),
					Principal,
					{ userId: "u1", email: "admin@x.com" },
				),
			);
			expect(id).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});

	it("adminDelete reports null for a missing row and denies non-admins", async () => {
		expect(
			await asUser(
				"u1",
				call((c) => c.adminDelete(424242)),
				"admin@x.com",
			),
		).toBeNull();
		const id = await createConsultation(testDb, { userId: "u1", source: "mic" });
		await expect(
			asUser(
				"u1",
				call((c) => c.adminDelete(id!)),
				"other@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("get and getLive let an admin read another owner's consultation", async () => {
		const id = await createConsultation(testDb, {
			userId: "u1",
			transcript: "secret",
			source: "mic",
		});
		const detail = await asUser(
			"u2",
			call((c) => c.get(id!, "u2")),
			"admin@x.com",
		);
		expect(detail?.transcript).toBe("secret");
		const live = await asUser(
			"u2",
			call((c) => c.getLive(id!, "u2")),
			"admin@x.com",
		);
		expect(live).toEqual({ transcript: "secret", status: "done" });
		// Non-admin still Forbidden.
		await expect(
			asUser(
				"u2",
				call((c) => c.get(id!, "u2")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
	});

	it("denies reads on ownerless rows (null userId)", async () => {
		const id = await createConsultation(testDb, { userId: "u1", source: "mic" });
		await testDb
			.update(consultationsTable)
			.set({ userId: null })
			.where(eq(consultationsTable.id, id!));
		await expect(
			asUser(
				"u1",
				call((c) => c.get(id!, "u1")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
		await expect(
			asUser(
				"u1",
				call((c) => c.getLive(id!, "u1")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
	});

	it("attachAnamnesis/recordConsent check entity ownership", async () => {
		const id = await asUser(
			"u1",
			call((c) => c.create({ userId: "u1", transcript: "t", source: "mic" })),
		);

		await asUser(
			"u1",
			call((c) =>
				c.attachAnamnesis("u1", {
					consultationId: id!,
					anamnesis: {} as SaveConsultationInput["anamnesis"],
					engine: "e",
				}),
			),
		);
		await asUser(
			"u1",
			call((c) => c.recordConsent(id!, "u1")),
		);

		// Cross-user mutation → Forbidden (owner lookup + permix update rule).
		await expect(
			asUser(
				"u2",
				call((c) =>
					c.attachAnamnesis("u2", {
						consultationId: id!,
						anamnesis: {} as SaveConsultationInput["anamnesis"],
						engine: "e",
					}),
				),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				"u2",
				call((c) => c.recordConsent(id!, "u2")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});

		// Missing row → owner lookup is null → update no-ops (no authz needed).
		await asUser(
			"u1",
			call((c) =>
				c.attachAnamnesis("u1", {
					consultationId: 9999,
					anamnesis: {} as SaveConsultationInput["anamnesis"],
					engine: "e",
				}),
			),
		);
		await asUser(
			"u1",
			call((c) => c.recordConsent(9999, "u1")),
		);
	});
});

describe("audio pipeline", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Consultations, never>;
	let testDb: ReturnType<typeof makeDb>;

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Consultations>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const call = <A, E>(f: (c: Consultations["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Consultations, f);

	beforeAll(() => {
		testDb = makeDb(makeD1(DDL));
		runtime = ManagedRuntime.make(ConsultationsLive.pipe(Layer.provide(liveDeps(testDb))));
	});

	afterAll(() => runtime.dispose());

	it("module helpers walk the job lifecycle", async () => {
		const id = (await createConsultation(testDb, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(testDb, id, {
			audioKey: "audio/u1/1/x.webm",
			contentType: "audio/webm",
			size: 10,
		});
		expect(await audioJobRecord(testDb, id)).toEqual({
			audioKey: "audio/u1/1/x.webm",
			audioStatus: "stored",
			userId: "u1",
			tenantId: null,
		});
		await markAudioQueued(testDb, id);
		await beginAudioJob(testDb, id);
		await completeAudioJob(testDb, id, "server text");
		await saveCorrectedTranscript(testDb, id, "corrected text", "anthropic");
		const row = await testDb.query.consultations.findFirst({
			where: (t, { eq }) => eq(t.id, id),
		});
		expect(row).toMatchObject({
			audioStatus: "done",
			serverTranscript: "server text",
			correctedTranscript: "corrected text",
			enhancementEngine: "anthropic",
		});
	});

	it("failAudioJob records the reason", async () => {
		const id = (await createConsultation(testDb, { userId: "u1", source: "browser" }))!;
		await failAudioJob(testDb, id, "too large");
		const row = await testDb.query.consultations.findFirst({
			where: (t, { eq }) => eq(t.id, id),
		});
		expect(row?.audioStatus).toBe("failed");
		expect(row?.audioError).toBe("too large");
	});

	it("attachAudio/updateAudioStatus enforce ownership", async () => {
		const id = (await createConsultation(testDb, { userId: "u1", source: "browser" }))!;
		await asUser(
			"u1",
			call((c) => c.attachAudio("u1", { consultationId: id, audioKey: "k", size: 1 })),
		);
		await asUser(
			"u1",
			call((c) => c.updateAudioStatus("u1", id, "queued")),
		);
		const row = await audioJobRecord(testDb, id);
		expect(row?.audioStatus).toBe("queued");
		await expect(
			asUser(
				"u2",
				call((c) => c.attachAudio("u2", { consultationId: id, audioKey: "k2" })),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				"u2",
				call((c) => c.updateAudioStatus("u2", id, "queued")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("audioJobsStream replays the projection then emits live deltas", async () => {
		const id = (await createConsultation(testDb, { userId: "u1", source: "browser" }))!;
		// Filtered take(1): skips the "none" backlog row for this
		// consultation, then waits for the live delta attachAudio publishes.
		const collect = asUser(
			"u1",
			call((c) =>
				c.audioJobsStream().pipe(
					Stream.filter((r) => r.id === id && r.audioStatus === "stored"),
					Stream.take(1),
					Stream.runCollect,
				),
			),
			"admin@x.com",
		);
		// Let the stream drain its backlog and subscribe to the PubSub
		// before the event fires — publishes before that are not replayed.
		await new Promise((r) => setTimeout(r, 100));
		await asUser(
			"u1",
			call((c) => c.attachAudio("u1", { consultationId: id, audioKey: "k-stream", size: 1 })),
		);
		const rows = await collect;
		expect(rows[0]?.audioStatus).toBe("stored");
		expect(rows[0]?.id).toBe(id);
	});

	it("audioJobsStream fails Forbidden for non-admin principals", async () => {
		await expect(
			asUser(
				"u1",
				call((c) => Stream.runCollect(c.audioJobsStream())),
				"other@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				null,
				call((c) => Stream.runCollect(c.audioJobsStream())),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});
});

describe("Consultations.history", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Consultations, never>;
	let testDb: ReturnType<typeof makeDb>;
	let patientId = 0;
	let q4Id = 0;

	const asUser = <A, E>(userId: string | null, effect: Effect.Effect<A, E, Consultations>) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId }),
		);

	const sec = (content: string) => ({ content, confidence: "alta", evidence: [] });
	const doc = (qp: string, conduta: string) =>
		JSON.stringify({
			queixa_principal: sec(qp),
			hda: sec("h"),
			antecedentes: sec("a"),
			alergias: sec("al"),
			medicamentos_em_uso: sec("m"),
			exame_fisico: sec("e"),
			hipoteses: sec("hi"),
			conduta: sec(conduta),
		});

	const addConsultation = async (over: Partial<typeof consultationsTable.$inferInsert>) => {
		const rows = await testDb
			.insert(consultationsTable)
			.values({
				userId: "u1",
				transcript: "t",
				source: "browser",
				status: "done",
				createdAt: new Date(),
				...over,
			})
			.returning({ id: consultationsTable.id });
		return rows[0]!.id;
	};

	beforeAll(async () => {
		testDb = makeDb(makeD1(DDL));
		runtime = ManagedRuntime.make(ConsultationsLive.pipe(Layer.provide(liveDeps(testDb))));
		const [p] = await testDb
			.insert(patientsTable)
			.values({ ownerId: "u1", name: "Maria", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		patientId = p!.id;
		await testDb.insert(userTable).values({
			id: "u2",
			name: "Dr B",
			email: "b@x.com",
			emailVerified: false,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});
		// 4 done consultations → only the latest 3 summarized, count = 4
		for (const [i, qp] of ["Q1", "Q2", "Q3", "Q4"].entries()) {
			q4Id = await addConsultation({
				patientId,
				anamnesis: doc(qp, `C${i + 1}`),
				createdAt: new Date(2026, 0, i + 1),
			});
		}
		// excluded from history: live session, other user, other patient
		await addConsultation({ patientId, status: "live", anamnesis: doc("QL", "CL") });
		await addConsultation({
			patientId,
			userId: "u2",
			anamnesis: doc("QX", "CX"),
		});
		const [other] = await testDb
			.insert(patientsTable)
			.values({ ownerId: "u1", name: "Outra", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		await addConsultation({ patientId: other!.id, anamnesis: doc("QO", "CO") });
	});

	afterAll(() => runtime.dispose());

	it("aggregates count + latest 3 visits with complaint and plan", async () => {
		const h = await asUser(
			"u1",
			Effect.flatMap(Consultations, (c) => c.history(patientId, "u1")),
		);
		expect(h?.count).toBe(4);
		expect(h?.visits).toHaveLength(3);
		// newest first
		expect(h?.visits[0]?.chiefComplaint).toBe("Q4");
		expect(h?.visits[0]?.plan).toBe("C4");
		expect(h?.visits.map((v) => v.chiefComplaint)).toEqual(["Q4", "Q3", "Q2"]);
		expect(h?.visits[0]?.date).toMatch(/^2026-01-04T/);
	});

	it("excludeId drops the consultation being viewed", async () => {
		const h = await asUser(
			"u1",
			Effect.flatMap(Consultations, (c) => c.history(patientId, "u1", q4Id)),
		);
		expect(h?.count).toBe(3);
		expect(h?.visits.map((v) => v.id)).not.toContain(q4Id);
		expect(h?.visits.map((v) => v.chiefComplaint)).toEqual(["Q3", "Q2", "Q1"]);
	});

	it("returns null for patients the caller does not own", async () => {
		const h = await asUser(
			"u1",
			Effect.flatMap(Consultations, (c) => c.history(99999, "u1")),
		);
		expect(h).toBeNull();
		// patient owned by u1 is invisible to u2
		const h2 = await asUser(
			"u2",
			Effect.flatMap(Consultations, (c) => c.history(patientId, "u2")),
		);
		expect(h2).toBeNull();
	});

	it("lists only the given patient's consultations, with patientId", async () => {
		const rows = await asUser(
			"u1",
			Effect.flatMap(Consultations, (c) => c.list("u1", patientId)),
		);
		// 4 done + 1 live for this patient; the other patient's and u2's are excluded
		expect(rows).toHaveLength(5);
		expect(rows.every((r) => r.patientId === patientId && r.patientName === "Maria")).toBe(true);
		const all = await asUser(
			"u1",
			Effect.flatMap(Consultations, (c) => c.list("u1")),
		);
		expect(all.length).toBeGreaterThan(rows.length);
	});

	it("denies history without a bound principal", async () => {
		await expect(
			asUser(
				null,
				Effect.flatMap(Consultations, (c) => c.history(patientId, "u1")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("nulls out missing anamnesis and pending placeholders", async () => {
		const [p2] = await testDb
			.insert(patientsTable)
			.values({ ownerId: "u1", name: "Sem docs", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		await addConsultation({ patientId: p2!.id }); // no anamnesis
		await addConsultation({
			patientId: p2!.id,
			anamnesis: doc("Q", "A preencher pelo médico: conduta."),
		});
		const h = await asUser(
			"u1",
			Effect.flatMap(Consultations, (c) => c.history(p2!.id, "u1")),
		);
		expect(h?.count).toBe(2);
		const bare = h?.visits.find((v) => v.chiefComplaint === null);
		expect(bare?.plan).toBeNull();
		const pending = h?.visits.find((v) => v.chiefComplaint === "Q");
		expect(pending?.plan).toBeNull();
	});
});

describe("patientId ownership on save/attach", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Consultations, never>;
	let testDb: ReturnType<typeof makeDb>;
	let ownPatient = 0;
	let foreignPatient = 0;

	const asUser = <A, E>(userId: string | null, effect: Effect.Effect<A, E, Consultations>) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId }),
		);
	const call = <A, E>(f: (c: Consultations["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Consultations, f);
	const saveInput = (over: Partial<SaveConsultationInput> = {}): SaveConsultationInput => ({
		transcript: "t",
		anamnesis: {} as SaveConsultationInput["anamnesis"],
		engine: "e",
		...over,
	});
	const attachInput = (
		over: Partial<Parameters<Consultations["Service"]["attachAnamnesis"]>[1]> = {},
	) => ({
		consultationId: 0,
		anamnesis: {} as SaveConsultationInput["anamnesis"],
		engine: "e",
		...over,
	});
	const linkedPatientId = async (id: number) =>
		(
			await testDb.query.consultations.findFirst({
				where: (t, { eq }) => eq(t.id, id),
			})
		)?.patientId;

	beforeAll(async () => {
		testDb = makeDb(makeD1(DDL));
		runtime = ManagedRuntime.make(ConsultationsLive.pipe(Layer.provide(liveDeps(testDb))));
		await testDb.insert(userTable).values({
			id: "u2",
			name: "Dr B",
			email: "b@x.com",
			emailVerified: false,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});
		const [own] = await testDb
			.insert(patientsTable)
			.values({ ownerId: "u1", name: "Own", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		const [foreign] = await testDb
			.insert(patientsTable)
			.values({ ownerId: "u2", name: "Foreign", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		ownPatient = own!.id;
		foreignPatient = foreign!.id;
	});

	afterAll(() => runtime.dispose());

	it("save rejects a patientId the caller does not own", async () => {
		await expect(
			asUser(
				"u1",
				call((c) => c.save("u1", saveInput({ patientId: foreignPatient }))),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		// Missing patient ids are denied the same way — no existence probe.
		await expect(
			asUser(
				"u1",
				call((c) => c.save("u1", saveInput({ patientId: 999_999 }))),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		// Own patient links fine; omitted patientId still works.
		const saved = await asUser(
			"u1",
			call((c) => c.save("u1", saveInput({ patientId: ownPatient }))),
		);
		expect(await linkedPatientId(saved.id)).toBe(ownPatient);
		const bare = await asUser(
			"u1",
			call((c) => c.save("u1", saveInput())),
		);
		expect(await linkedPatientId(bare.id)).toBeNull();
	});

	it("attachAnamnesis rejects foreign patientId and keeps tri-state semantics", async () => {
		const id = (await asUser(
			"u1",
			call((c) => c.create({ userId: "u1", transcript: "t", source: "browser" })),
		))!;

		// Foreign patient → Forbidden, link untouched.
		await expect(
			asUser(
				"u1",
				call((c) =>
					c.attachAnamnesis("u1", attachInput({ consultationId: id, patientId: foreignPatient })),
				),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		expect(await linkedPatientId(id)).toBeNull();

		// Own patient links.
		await asUser(
			"u1",
			call((c) =>
				c.attachAnamnesis("u1", attachInput({ consultationId: id, patientId: ownPatient })),
			),
		);
		expect(await linkedPatientId(id)).toBe(ownPatient);

		// undefined keeps the existing link.
		await asUser(
			"u1",
			call((c) => c.attachAnamnesis("u1", attachInput({ consultationId: id }))),
		);
		expect(await linkedPatientId(id)).toBe(ownPatient);

		// null clears it.
		await asUser(
			"u1",
			call((c) => c.attachAnamnesis("u1", attachInput({ consultationId: id, patientId: null }))),
		);
		expect(await linkedPatientId(id)).toBeNull();
	});
});

describe("consultations.audioJobs query", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Query.Registered<typeof ConsultationsQueries>, never>;
	let testDb: ReturnType<typeof makeDb>;

	const dispatch = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Query.Registered<typeof ConsultationsQueries>>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const audioJobs = (userId: string | null, email?: string) =>
		dispatch(
			userId,
			Effect.scoped(
				Effect.gen(function* () {
					const queries = yield* Query.dispatcher(ConsultationsQueries);
					return yield* queries["consultations.audioJobs"]({});
				}),
			),
			email,
		);

	beforeAll(async () => {
		testDb = makeDb(makeD1(DDL));
		runtime = ManagedRuntime.make(
			ConsultationsQueriesLive.pipe(Layer.provide(liveDeps(testDb))),
		) as ManagedRuntime.ManagedRuntime<Query.Registered<typeof ConsultationsQueries>, never>;
		const [p] = await testDb
			.insert(patientsTable)
			.values({ ownerId: "u1", name: "Jobs Paciente", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		const id = (await createConsultation(testDb, { userId: "u1", source: "browser" }))!;
		await testDb
			.update(consultationsTable)
			.set({
				patientId: p!.id,
				audioStatus: "processing",
				audioError: null,
			})
			.where(eq(consultationsTable.id, id));
	});

	afterAll(() => runtime.dispose());

	it("returns the minimal audio-job projection for an allowlisted admin", async () => {
		const rows = await audioJobs("u1", "admin@x.com");
		const row = rows.find((r) => r.audioStatus === "processing");
		expect(row).toBeDefined();
		expect(row).toMatchObject({ patientName: "Jobs Paciente", audioError: null });
		expect(row?.createdAt).toBeInstanceOf(Date);
	});

	it("fails Forbidden for non-admin, missing email and null principal", async () => {
		await expect(audioJobs("u1", "other@x.com")).rejects.toMatchObject({
			_tag: "Forbidden",
			path: "platform.admin",
		});
		await expect(audioJobs("u1")).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(audioJobs(null)).rejects.toMatchObject({ _tag: "Forbidden" });
	});
});

describe("plugins", () => {
	it("declares tables, services, routes, nav and panel as single-concern plugins", () => {
		expect(consultationsTablesPlugin.id).toBe("consultations.tables");
		expect(consultationsTablesPlugin.tables?.consultations).toBeDefined();
		expect(consultationsServicesPlugin.id).toBe("consultations.services");
		expect(consultationsServicesPlugin.services).toBeDefined();
		expect(consultationsServicesPlugin.requiredDeps).toEqual([
			patientsServicesPlugin.id,
			platformAdminPlugin.id,
		]);
		expect(consultationsLandingNavPlugin.id).toBe("consultations.landing-nav");
		expect(consultationsLandingNavPlugin.landingNav?.[0]?.to).toBe("/consultations");
		expect(consultationsPanelPlugin.id).toBe("consultations.panel");
		expect(consultationsPanelPlugin.requiredDeps).toEqual([platformPanelPlugin.id]);
		expect(consultationsPanelPlugin.panel?.sidebar).toEqual([
			{
				to: "/platform/consultations",
				label: "Consultations",
				icon: ClipboardListIcon,
				group: "Domains",
			},
		]);
	});

	it("declares the /consultations route subtree", () => {
		expect(consultationsRoutesPlugin.id).toBe("consultations.routes");
		// P-033: the subtree is a physical() mount of this package's own
		// src/routes directory — resolved against the host routes dir.
		expect(JSON.stringify(consultationsRoutesPlugin.routes)).toContain(
			"plugins/consultations/src/routes",
		);
	});

	it("platform loader maps blank owner fields to an empty label", async () => {
		const loader = consultationsPanelPlugin.panel?.pages?.[0]?.loader;
		expect(loader).toBeDefined();
		const result = await Effect.runPromise(
			loader!().pipe(
				Effect.provideService(Consultations, {
					adminList: () => Effect.succeed([]),
				} as never),
				Effect.provideService(Patients, {
					adminOwners: () => Effect.succeed([]),
					adminList: () =>
						Effect.succeed([
							{ id: 1, name: "Pat", ownerId: "u9", ownerName: null, ownerEmail: null },
						] as never),
				} as never),
			),
		);
		expect(result).toEqual({
			consultations: [],
			owners: [],
			patients: [{ id: 1, name: "Pat", ownerId: "u9", ownerName: "" }],
		});
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual([
			"consultations.tables",
			"consultations.services",
			"consultations.routes",
			"consultations.landing-nav",
			"consultations.panel",
		]);
	});
});

describe("ConsultationsLive tenant scope (P-053)", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Consultations, never>;
	let busRuntime: ManagedRuntime.ManagedRuntime<EventBus, never>;
	let testDb: ReturnType<typeof makeDb>;
	let bus: EventBusShape;

	const TENANT_A: TenantScope = { id: 7, kind: "clinic", slug: "clinica-a", role: "member" };
	const TENANT_B: TenantScope = { id: 8, kind: "clinic", slug: "clinica-b", role: "member" };

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Consultations>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const asTenant = <A, E>(
		userId: string,
		tenant: TenantScope,
		effect: Effect.Effect<A, E, Consultations>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(
				Effect.provideService(effect, Principal, { userId, email }),
				Tenant,
				tenant,
			),
		);

	const call = <A, E>(f: (c: Consultations["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Consultations, f);

	const saveInput = (over: Partial<SaveConsultationInput> = {}): SaveConsultationInput => ({
		transcript: "t",
		anamnesis: {} as SaveConsultationInput["anamnesis"],
		engine: "e",
		...over,
	});

	const tenantIdOf = async (id: number) => {
		const rows = await testDb
			.select({ tenantId: consultationsTable.tenantId })
			.from(consultationsTable)
			.where(eq(consultationsTable.id, id));
		return rows[0]?.tenantId ?? null;
	};

	beforeAll(async () => {
		testDb = makeDb(makeD1(DDL));
		// The shared DDL seeds only u1 — tenant-member scenarios need u2
		// (the consultations.user_id FK is enforced by better-sqlite3).
		await testDb.insert(userTable).values({
			id: "u2",
			name: "Dr B",
			email: "b@x.com",
			emailVerified: false,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});
		// Build the bus explicitly so tests can subscribe to the same
		// instance the service layer dispatches on.
		busRuntime = ManagedRuntime.make(makeEventBus());
		bus = await busRuntime.runPromise(EventBus);
		runtime = ManagedRuntime.make(
			ConsultationsLive.pipe(Layer.provide(liveDeps(testDb, Layer.succeed(EventBus, bus)))),
		);
	});

	afterAll(async () => {
		await runtime.dispose();
		await busRuntime.dispose();
	});

	it("create/save/adminCreate stamp tenant_id from the bound tenant", async () => {
		const id = await asTenant(
			"u1",
			TENANT_A,
			call((c) => c.create({ userId: "u1", source: "browser" })),
		);
		expect(await tenantIdOf(id!)).toBe(7);

		const saved = await asTenant(
			"u1",
			TENANT_A,
			call((c) => c.save("u1", saveInput())),
		);
		expect(await tenantIdOf(saved.id)).toBe(7);

		const admin = await asTenant(
			"u1",
			TENANT_A,
			call((c) => c.adminCreate({ userId: "u2", source: "manual" })),
			"admin@x.com",
		);
		expect(await tenantIdOf(admin!)).toBe(7);

		// Personal scope and non-numeric tenant ids both stamp NULL.
		const personal = await asUser(
			"u1",
			call((c) => c.create({ userId: "u1", source: "browser" })),
		);
		expect(await tenantIdOf(personal!)).toBeNull();
		const weird = await asTenant(
			"u1",
			{ ...TENANT_A, id: "clinic-x" },
			call((c) => c.create({ userId: "u1", source: "browser" })),
		);
		expect(await tenantIdOf(weird!)).toBeNull();
	});

	it("list shows tenant consultations to members and hides them from outsiders and personal scope", async () => {
		const t7 = await createConsultation(testDb, { userId: "u1", source: "browser" }, 7);
		const t8 = await createConsultation(testDb, { userId: "u1", source: "browser" }, 8);

		const member = await asTenant(
			"u2",
			TENANT_A,
			call((c) => c.list("u2")),
		);
		const memberIds = member.map((r) => r.id);
		expect(memberIds).toContain(t7);
		expect(memberIds).not.toContain(t8);

		// Personal scope: tenant rows are invisible even to their creator.
		const personal = await asUser(
			"u1",
			call((c) => c.list("u1")),
		);
		const personalIds = personal.map((r) => r.id);
		expect(personalIds).not.toContain(t7);
		expect(personalIds).not.toContain(t8);
	});

	it("get/getLive let tenant members read tenant rows; outsiders and personal-scope owners are Forbidden", async () => {
		const t7 = await createConsultation(
			testDb,
			{ userId: "u1", transcript: "shared", source: "mic", status: "live" },
			7,
		);

		const got = await asTenant(
			"u2",
			TENANT_A,
			call((c) => c.get(t7!, "u2")),
		);
		expect(got?.transcript).toBe("shared");
		const live = await asTenant(
			"u2",
			TENANT_A,
			call((c) => c.getLive(t7!, "u2")),
		);
		expect(live).toEqual({ transcript: "shared", status: "live" });

		// Member of a different tenant → Forbidden.
		await expect(
			asTenant(
				"u2",
				TENANT_B,
				call((c) => c.get(t7!, "u2")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "consultation.read" });
		// The creator in personal scope → Forbidden (strict tenant rows).
		await expect(
			asUser(
				"u1",
				call((c) => c.get(t7!, "u1")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		// Platform admin reads cross-tenant.
		const admin = await asTenant(
			"u1",
			TENANT_B,
			call((c) => c.get(t7!, "u1")),
			"admin@x.com",
		);
		expect(admin?.transcript).toBe("shared");
	});

	it("attachAnamnesis/recordConsent let tenant members update tenant rows", async () => {
		const t7 = await createConsultation(testDb, { userId: "u1", source: "mic" }, 7);
		const anamnesis = {} as SaveConsultationInput["anamnesis"];

		await asTenant(
			"u2",
			TENANT_A,
			call((c) => c.attachAnamnesis("u2", { consultationId: t7!, anamnesis, engine: "e" })),
		);
		await asTenant(
			"u2",
			TENANT_A,
			call((c) => c.recordConsent(t7!, "u2")),
		);
		const rows = await testDb
			.select({
				anamnesis: consultationsTable.anamnesis,
				consentAt: consultationsTable.consentAt,
			})
			.from(consultationsTable)
			.where(eq(consultationsTable.id, t7!));
		expect(rows[0]?.anamnesis).not.toBeNull();
		expect(rows[0]?.consentAt).toBeInstanceOf(Date);

		// Non-member → Forbidden on both paths.
		await expect(
			asTenant(
				"u2",
				TENANT_B,
				call((c) => c.attachAnamnesis("u2", { consultationId: t7!, anamnesis, engine: "e2" })),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asTenant(
				"u2",
				TENANT_B,
				call((c) => c.recordConsent(t7!, "u2")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("attachAudio/updateAudioStatus stamp the row's tenant_id on audio events", async () => {
		const t7 = await createConsultation(testDb, { userId: "u1", source: "mic" }, 7);
		const seen: (number | null | undefined)[] = [];
		await Effect.runPromise(
			bus.subscribe(ConsultationAudioUpdated, (e) =>
				Effect.sync(() => {
					seen.push(e.tenantId);
				}),
			),
		);
		// Tenant member operates the shared row — both events carry tenant 7.
		await asTenant(
			"u2",
			TENANT_A,
			call((c) => c.attachAudio("u2", { consultationId: t7!, audioKey: "k-t", size: 1 })),
		);
		await asTenant(
			"u2",
			TENANT_A,
			call((c) => c.updateAudioStatus("u2", t7!, "queued")),
		);
		expect(seen).toEqual([7, 7]);
	});

	it("save links tenant patients for members and rejects non-members", async () => {
		const patient = (
			await testDb
				.insert(patientsTable)
				.values({ ownerId: "u1", name: "Tenant Patient", tenantId: 7, createdAt: new Date() })
				.returning({ id: patientsTable.id })
		)[0]!;

		// Member of tenant 7 links the shared patient; the consultation
		// is stamped with the bound tenant.
		const saved = await asTenant(
			"u2",
			TENANT_A,
			call((c) => c.save("u2", saveInput({ patientId: patient.id }))),
		);
		expect(await tenantIdOf(saved.id)).toBe(7);

		// Member of another tenant → Forbidden (can't probe patient ids).
		await expect(
			asTenant(
				"u2",
				TENANT_B,
				call((c) => c.save("u2", saveInput({ patientId: patient.id }))),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "patient.read" });

		// The patient's owner in personal scope → Forbidden: tenant
		// patients need tenant context to link.
		await expect(
			asUser(
				"u1",
				call((c) => c.save("u1", saveInput({ patientId: patient.id }))),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});
});

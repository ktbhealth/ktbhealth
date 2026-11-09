import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { Db, makeDb } from "@ktb/db";
import { user as userTable } from "@ktb/db/schema";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import { patients as patientsTable } from "@ktb/patients/schema";
import { patientsServicesPlugin, PatientsCommandsLive, PatientsQueriesLive } from "@ktb/patients";
import { makeEventBus, Query } from "@effect-server-utils/cqrs";
import {
	makePlatformAdminGate,
	parsePlatformAdminEmails,
	PlatformAdmin,
	platformAdminPlugin,
	platformPanelPlugin,
} from "@ktb/platform";
import { ClipboardListIcon } from "lucide-react";
import { consultations as consultationsTable } from "./schema.ts";
import { ConsultationsQueries } from "./api.ts";
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

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL);
`;

// ConsultationsLive requires PlatformAdmin (adminList) — every runtime
// below provides the same allowlisted gate.
const liveDeps = (db: ReturnType<typeof makeDb>) => {
	const infra = Layer.mergeAll(
		Layer.succeed(Db, db),
		Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		makeEventBus(),
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

	const asUser = <A, E>(userId: string | null, effect: Effect.Effect<A, E, Consultations>) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId }),
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

describe("Consultations.deletePatient", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Consultations, never>;
	let testDb: ReturnType<typeof makeDb>;

	const asUser = <A, E>(userId: string | null, effect: Effect.Effect<A, E, Consultations>) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId }),
		);
	const remove = (userId: string | null, actAs: string, patientId: number) =>
		asUser(
			userId,
			Effect.gen(function* () {
				const c = yield* Consultations;
				return yield* c.deletePatient(actAs, patientId);
			}),
		);

	const addPatient = async (ownerId = "u1") => {
		const [p] = await testDb
			.insert(patientsTable)
			.values({ ownerId, name: "Maria", createdAt: new Date() })
			.returning({ id: patientsTable.id });
		return p!.id;
	};
	const addConsultation = async (
		patientId: number,
		over: Partial<typeof consultationsTable.$inferInsert> = {},
	) => {
		const rows = await testDb
			.insert(consultationsTable)
			.values({
				userId: "u1",
				patientId,
				transcript: "t",
				source: "browser",
				status: "done",
				createdAt: new Date(),
				...over,
			})
			.returning({ id: consultationsTable.id });
		return rows[0]!.id;
	};
	const patientExists = async (id: number) =>
		(await testDb.select().from(patientsTable).where(eq(patientsTable.id, id))).length === 1;
	const consultationCount = async (patientId: number) =>
		(
			await testDb
				.select()
				.from(consultationsTable)
				.where(eq(consultationsTable.patientId, patientId))
		).length;

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
	});
	afterAll(() => runtime.dispose());

	it("deletes the patient with every linked consultation and returns their audio keys", async () => {
		const patientId = await addPatient();
		const other = await addPatient();
		await addConsultation(patientId, { audioKey: "audio/a.webm" });
		await addConsultation(patientId);
		await addConsultation(other);
		expect(await remove("u1", "u1", patientId)).toEqual({
			consultations: 2,
			audioKeys: ["audio/a.webm"],
		});
		expect(await patientExists(patientId)).toBe(false);
		expect(await consultationCount(patientId)).toBe(0);
		// Other patients are untouched.
		expect(await patientExists(other)).toBe(true);
		expect(await consultationCount(other)).toBe(1);
	});

	it("deletes a patient without consultations and reports a missing one as null", async () => {
		const patientId = await addPatient();
		expect(await remove("u1", "u1", patientId)).toEqual({ consultations: 0, audioKeys: [] });
		expect(await remove("u1", "u1", 99_999)).toBeNull();
	});

	it("is owner-only and deletes nothing when any check fails", async () => {
		const patientId = await addPatient();
		await addConsultation(patientId);
		await expect(remove(null, "u1", patientId)).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(remove("u2", "u1", patientId)).rejects.toMatchObject({ _tag: "Forbidden" });
		// Someone else's patient.
		await expect(remove("u2", "u2", patientId)).rejects.toMatchObject({ _tag: "Forbidden" });
		// A linked consultation owned by another user (or by nobody) blocks the cascade.
		const shared = await addPatient();
		await addConsultation(shared);
		await addConsultation(shared, { userId: "u2" });
		await expect(remove("u1", "u1", shared)).rejects.toMatchObject({ _tag: "Forbidden" });
		const orphan = await addPatient();
		await addConsultation(orphan, { userId: null });
		await expect(remove("u1", "u1", orphan)).rejects.toMatchObject({ _tag: "Forbidden" });
		for (const id of [patientId, shared, orphan]) expect(await patientExists(id)).toBe(true);
		expect(await consultationCount(shared)).toBe(2);
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

	it("owns the consultations route subtree", () => {
		const paths = (consultationsRoutesPlugin.routes ?? []).map((n) =>
			n.type === "route" ? n.path : n.type,
		);
		expect(paths).toEqual(["consultations"]);
		const [consultations] = consultationsRoutesPlugin.routes ?? [];
		expect(consultations).toMatchObject({
			type: "route",
			path: "consultations",
			children: [
				{ type: "index", file: "consultations/index.tsx" },
				{ type: "route", path: "$id", file: "consultations/$id.tsx" },
				{ type: "route", path: "new", file: "consultations/new.tsx" },
			],
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

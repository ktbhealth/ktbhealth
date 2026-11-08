import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { Db, makeDb } from "@ktb/db";
import { user as userTable } from "@ktb/db/schema";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import { patients as patientsTable } from "@ktb/patients/schema";
import { consultations as consultationsTable } from "./schema.ts";
import {
	Consultations,
	ConsultationsLive,
	appendTranscript,
	createConsultation,
	finishConsultation,
	ownsBot,
	plugin,
	type SaveConsultationInput,
} from "./index.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, created_at INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, created_at INTEGER NOT NULL);
`;

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
});

describe("ConsultationsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Consultations, never>;
	let testDb: ReturnType<typeof makeDb>;

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

	beforeAll(() => {
		testDb = makeDb(makeD1(DDL));
		runtime = ManagedRuntime.make(ConsultationsLive.pipe(Layer.provide(Layer.succeed(Db, testDb))));
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
		runtime = ManagedRuntime.make(ConsultationsLive.pipe(Layer.provide(Layer.succeed(Db, testDb))));
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

describe("plugin", () => {
	it("has id, nav, tables", () => {
		expect(plugin.id).toBe("consultations");
		expect(plugin.nav?.[0]?.to).toBe("/consultations");
		expect(plugin.tables?.consultations).toBeDefined();
	});

	it("owns the consultations route subtree", () => {
		const paths = (plugin.routes ?? []).map((n) => (n.type === "route" ? n.path : n.type));
		expect(paths).toEqual(["consultations"]);
		const [consultations] = plugin.routes ?? [];
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
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
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

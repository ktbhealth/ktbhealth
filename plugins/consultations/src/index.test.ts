import { beforeAll, describe, expect, it } from "vitest";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import {
	Consultations,
	ConsultationsLive,
	appendTranscript,
	createConsultation,
	finishConsultation,
	plugin,
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
	it("service methods create/append/finish run through the layer", async () => {
		const testDb = makeDb(makeD1(DDL));
		const runtime = ManagedRuntime.make(
			ConsultationsLive.pipe(Layer.provide(Layer.succeed(Db, testDb))),
		);
		const id = await runtime.runPromise(
			Effect.gen(function* () {
				const c = yield* Consultations;
				const created = yield* c.create({ userId: "u1", source: "browser" });
				yield* c.appendTranscript(created!, "svc chunk");
				yield* c.finish(created!);
				return created;
			}),
		);
		expect(id).toBeTypeOf("number");
		await runtime.dispose();
	});
});

describe("plugin", () => {
	it("has id, nav, tables", () => {
		expect(plugin.id).toBe("consultations");
		expect(plugin.nav?.[0]?.to).toBe("/consultas");
		expect(plugin.tables?.consultations).toBeDefined();
	});
});

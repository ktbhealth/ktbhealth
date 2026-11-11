import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import { PatientsCommandsLive, PatientsQueriesLive } from "@ktb/patients";
import { makeEventBus } from "@effect-server-utils/cqrs";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { consultations as consultationsTable } from "./schema.ts";
import {
	Consultations,
	ConsultationsLive,
	attachAudioRecord,
	audioJobRecord,
	audioJobRow,
	createConsultation,
} from "./index.ts";

// Branch/function gaps in index.ts that the main suite does not reach:
// optional audio fields, missing rows and unowned consultations.

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER, tenant_id INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL, tenant_id INTEGER);
`;

const liveDeps = (db: ReturnType<typeof makeDb>) => {
	const infra = Layer.mergeAll(
		Layer.succeed(Db, db),
		Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		makeEventBus(),
	);
	return Layer.mergeAll(
		infra,
		Layer.mergeAll(PatientsQueriesLive, PatientsCommandsLive).pipe(Layer.provide(infra)),
	);
};

const asUser = <A, E, R>(
	runtime: ManagedRuntime.ManagedRuntime<R, never>,
	userId: string,
	effect: Effect.Effect<A, E, R>,
) => runtime.runPromise(Effect.provideService(effect, Principal, { userId }));

describe("audio record helpers", () => {
	let db: ReturnType<typeof makeDb>;
	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("stores null content type and size when they are not provided", async () => {
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/k.webm" });
		const record = await audioJobRecord(db, id);
		expect(record).toMatchObject({ audioKey: "audio/u1/k.webm", audioStatus: "stored" });
		const [row] = await db
			.select({ type: consultationsTable.audioContentType, size: consultationsTable.audioSize })
			.from(consultationsTable)
			.where(eq(consultationsTable.id, id));
		expect(row).toEqual({ type: null, size: null });
	});

	it("audioJobRow is null for an unknown consultation", async () => {
		await expect(audioJobRow(db, 987654)).resolves.toBeNull();
	});
});

describe("ConsultationsLive on unknown consultations", () => {
	let db: ReturnType<typeof makeDb>;
	let runtime: ManagedRuntime.ManagedRuntime<Consultations, never>;
	const call = <A, E>(f: (c: Consultations["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Consultations, f);

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
		runtime = ManagedRuntime.make(ConsultationsLive.pipe(Layer.provide(liveDeps(db))));
	});
	afterAll(() => runtime.dispose());

	it("attachAudio skips the owner check when no row exists and publishes nothing", async () => {
		await asUser(
			runtime,
			"u1",
			call((c) => c.attachAudio("u1", { consultationId: 424242, audioKey: "k" })),
		);
		// The after-commit subscriber re-reads the row; a missing one emits nothing.
		await new Promise((r) => setTimeout(r, 50));
		await expect(audioJobRow(db, 424242)).resolves.toBeNull();
	});

	it("updateAudioStatus skips the owner check when no row exists", async () => {
		await asUser(
			runtime,
			"u1",
			call((c) => c.updateAudioStatus("u1", 424243, "queued")),
		);
		await new Promise((r) => setTimeout(r, 50));
		await expect(audioJobRow(db, 424243)).resolves.toBeNull();
	});
});

const call = <A, E>(f: (c: Consultations["Service"]) => Effect.Effect<A, E>) =>
	Effect.flatMap(Consultations, f);

describe("Consultations.create when the insert returns no row", () => {
	it("returns null and dispatches no creation event", async () => {
		const emptyInsert = {
			insert: () => ({ values: () => ({ returning: async () => [] }) }),
		} as unknown as ReturnType<typeof makeDb>;
		const runtime = ManagedRuntime.make(
			ConsultationsLive.pipe(Layer.provide(liveDeps(emptyInsert))),
		);
		try {
			const id = await asUser(
				runtime,
				"u1",
				call((c) => c.create({ userId: "u1", source: "browser" })),
			);
			expect(id).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import { PatientCascadeCommands, PatientRecordConsultationsQueries } from "@ktb/patients/api";
import { patients as patientsTable } from "@ktb/patients/schema";
import { PatientsCommandsLive, PatientsQueriesLive } from "@ktb/patients";
import { Command, makeEventBus, Query } from "@effect-server-utils/cqrs";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { consultations as consultationsTable } from "./schema.ts";
import {
	PatientDeleteCascadeLive,
	PatientRecordConsultationsLive,
	createConsultation,
} from "./index.ts";

// The patient-record query and the delete-cascade command that the
// consultations plugin registers for @ktb/patients: unauthenticated callers,
// linked rows without an owner, and consultations with/without stored audio.

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL);
`;

type Registered = Query.Registered<typeof PatientRecordConsultationsQueries> &
	Command.Registered<typeof PatientCascadeCommands>;

describe("patient record query and delete cascade", () => {
	let db: ReturnType<typeof makeDb>;
	let runtime: ManagedRuntime.ManagedRuntime<Registered, never>;
	let ana: number;
	let bia: number;

	const asUser = <A, E, R>(effect: Effect.Effect<A, E, R>, userId?: string) =>
		userId === undefined ? effect : Effect.provideService(effect, Principal, { userId });

	const asAdmin = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, Principal, { userId: "u2", email: "admin@x.com" });

	const recordConsultations = (patientId: number, userId?: string) =>
		runtime.runPromise(
			asUser(
				Effect.scoped(
					Effect.gen(function* () {
						const queries = yield* Query.dispatcher(PatientRecordConsultationsQueries);
						return yield* queries["patients.recordConsultations"]({ patientId });
					}),
				),
				userId,
			) as Effect.Effect<unknown, unknown, Registered>,
		);

	const deleteCascade = (patientId: number, userId?: string) =>
		runtime.runPromise(
			asUser(
				Effect.scoped(
					Effect.gen(function* () {
						const commands = yield* Command.dispatcher(PatientCascadeCommands);
						return yield* commands["patients.deleteCascade"]({ patientId });
					}),
				),
				userId,
			) as Effect.Effect<unknown, unknown, Registered>,
		);

	beforeAll(async () => {
		db = makeDb(makeD1(DDL));
		const infra = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
			makeEventBus(),
		);
		const deps = Layer.mergeAll(
			infra,
			Layer.mergeAll(PatientsQueriesLive, PatientsCommandsLive).pipe(Layer.provide(infra)),
		);
		runtime = ManagedRuntime.make(
			Layer.mergeAll(PatientRecordConsultationsLive, PatientDeleteCascadeLive).pipe(
				Layer.provide(deps),
			),
		) as unknown as ManagedRuntime.ManagedRuntime<Registered, never>;

		const [a, b] = await db
			.insert(patientsTable)
			.values([
				{ ownerId: "u1", name: "Ana", createdAt: new Date() },
				{ ownerId: "u1", name: "Bia", createdAt: new Date() },
			])
			.returning({ id: patientsTable.id });
		ana = a!.id;
		bia = b!.id;

		// Ana: one consultation with stored audio, one without.
		const withAudio = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		const withoutAudio = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await db
			.update(consultationsTable)
			.set({ patientId: ana, audioKey: "audio/u1/a.webm" })
			.where(eq(consultationsTable.id, withAudio));
		await db
			.update(consultationsTable)
			.set({ patientId: ana })
			.where(eq(consultationsTable.id, withoutAudio));

		// Bia: a stray linked consultation that has no owner at all.
		await db.insert(consultationsTable).values({
			userId: null,
			patientId: bia,
			transcript: "",
			source: "browser",
			status: "done",
			createdAt: new Date(),
		});
	});
	afterAll(() => runtime.dispose());

	describe("patients.recordConsultations", () => {
		it("lists the owner's consultations for that patient", async () => {
			const rows = (await recordConsultations(ana, "u1")) as { patientId: number }[];
			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.patientId === ana)).toBe(true);
		});

		it("fails Forbidden without a bound principal", async () => {
			await expect(recordConsultations(ana)).rejects.toMatchObject({ _tag: "Forbidden" });
		});

		it("lets a platform admin read another owner's patient consultations", async () => {
			const rows = (await runtime.runPromise(
				asAdmin(
					Effect.scoped(
						Effect.gen(function* () {
							const queries = yield* Query.dispatcher(PatientRecordConsultationsQueries);
							return yield* queries["patients.recordConsultations"]({ patientId: ana });
						}),
					) as Effect.Effect<unknown, unknown, Registered>,
				),
			)) as { patientId: number; chiefComplaint: string | null }[];
			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.patientId === ana)).toBe(true);
		});
	});

	describe("patients.deleteCascade", () => {
		it("fails Forbidden without a bound principal", async () => {
			await expect(deleteCascade(ana)).rejects.toMatchObject({ _tag: "Forbidden" });
		});

		it("refuses to cascade over a linked consultation that nobody owns", async () => {
			await expect(deleteCascade(bia, "u1")).rejects.toMatchObject({ _tag: "Forbidden" });
		});

		it("deletes the rows and returns the audio keys of the ones that had audio", async () => {
			await expect(deleteCascade(ana, "u1")).resolves.toEqual({
				consultations: 2,
				audioKeys: ["audio/u1/a.webm"],
			});
			await expect(recordConsultations(ana, "u1")).resolves.toEqual([]);
		});

		it("lets a platform admin cascade over ownerless and cross-owner rows", async () => {
			// bia's only linked consultation has userId NULL — an owner
			// principal is refused, an admin removes it.
			await runtime
				.runPromise(
					asAdmin(
						Effect.scoped(
							Effect.gen(function* () {
								const commands = yield* Command.dispatcher(PatientCascadeCommands);
								return yield* commands["patients.deleteCascade"]({ patientId: bia });
							}),
						) as Effect.Effect<unknown, unknown, Registered>,
					),
				)
				.then((res) => {
					expect(res).toEqual({ consultations: 1, audioKeys: [] });
				});
		});
	});
});

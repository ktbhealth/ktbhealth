import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Forbidden, Principal } from "@ktb/authz";
import { createPatient, PatientsCommandsLive, PatientsQueriesLive } from "@ktb/patients";
import { validatePatient } from "@ktb/patients/record";
import { patients as patientsTable } from "@ktb/patients/schema";
import { PatientCascadeCommands, PatientRecordConsultationsQueries } from "@ktb/patients/api";
import { makeEventBus, Command, Query } from "@effect-server-utils/cqrs";
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

// The `patients.*` CQRS surface this plugin registers for the patients
// plugin's server functions: owner-scoped record reads and the delete
// cascade. These tests dispatch the groups directly so the defensive
// branches (null principal, missing owner, foreign/ownerless rows) are
// reachable — the fn-level path always binds a real principal.

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
INSERT INTO "user" VALUES ('u2', 'Dr B', 'b@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL);
`;

const fields = (name: string) => {
	const r = validatePatient({ name, birthDate: "1984-03-05" });
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.fields;
};

describe("patients.* CQRS surface", () => {
	let db: ReturnType<typeof makeDb>;
	let runtime: ManagedRuntime.ManagedRuntime<unknown, never>;

	const run = <A, E, R>(principal: { userId: string } | null, effect: Effect.Effect<A, E, R>) =>
		runtime.runPromise(
			effect.pipe(Effect.provideService(Principal, principal), Effect.scoped) as Effect.Effect<
				A,
				E,
				never
			>,
		);

	const recordConsultations = (patientId: number, userId: string | null) =>
		run(
			userId === null ? null : { userId },
			Effect.gen(function* () {
				const queries = yield* Query.dispatcher(PatientRecordConsultationsQueries);
				return yield* queries["patients.recordConsultations"]({ patientId });
			}),
		);

	const deleteCascade = (patientId: number, userId: string | null) =>
		run(
			userId === null ? null : { userId },
			Effect.gen(function* () {
				const commands = yield* Command.dispatcher(PatientCascadeCommands);
				return yield* commands["patients.deleteCascade"]({ patientId });
			}),
		);

	/** Consultation row linked to a patient, owned by `userId` (null = ownerless). */
	const linkedConsultation = async (
		patientId: number,
		userId: string | null,
		audioKey: string | null = null,
	) => {
		const id = (await createConsultation(db, { userId: userId ?? "u1", source: "browser" }))!;
		await db
			.update(consultationsTable)
			.set({ patientId, userId, audioKey })
			.where(eq(consultationsTable.id, id));
		return id;
	};

	beforeAll(async () => {
		db = makeDb(makeD1(DDL));
		const infra = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
			makeEventBus(),
		);
		const patientsHandlers = Layer.mergeAll(PatientsQueriesLive, PatientsCommandsLive).pipe(
			Layer.provide(infra),
		);
		const live = Layer.mergeAll(PatientRecordConsultationsLive, PatientDeleteCascadeLive).pipe(
			Layer.provide(Layer.mergeAll(infra, patientsHandlers)),
		);
		runtime = ManagedRuntime.make(live as Layer.Layer<unknown, never, never>);
	});

	afterAll(() => runtime.dispose());

	describe("patients.recordConsultations", () => {
		it("lists the patient's consultations for the owner, mapped to the wire shape", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Read")))!;
			const withAudio = await linkedConsultation(patient.id, "u1", "audio/u1/x.webm");
			const plain = await linkedConsultation(patient.id, "u1");

			const rows = await recordConsultations(patient.id, "u1");
			expect(rows.map((r) => r.id).sort()).toEqual([withAudio, plain].sort());
			for (const row of rows) {
				expect(row.patientId).toBe(patient.id);
				expect(row.hasAnamnesis).toBe(false);
				expect(row.chiefComplaint).toBeNull();
			}
		});

		it("returns an empty list for a patient with no consultations", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Empty")))!;
			await expect(recordConsultations(patient.id, "u1")).resolves.toEqual([]);
		});

		it("fails Forbidden without a bound principal", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Null")))!;
			await expect(recordConsultations(patient.id, null)).rejects.toBeInstanceOf(Forbidden);
		});

		it("returns an empty list for a non-owner principal (owner-scoped read)", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Foreign")))!;
			await linkedConsultation(patient.id, "u1");
			await expect(recordConsultations(patient.id, "u2")).resolves.toEqual([]);
		});
	});

	describe("patients.deleteCascade", () => {
		it("deletes the consultations and the patient, returning audio keys", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Delete")))!;
			const withAudio = await linkedConsultation(patient.id, "u1", "audio/u1/cascade.webm");
			const plain = await linkedConsultation(patient.id, "u1");

			const result = await deleteCascade(patient.id, "u1");
			expect(result).toEqual({ consultations: 2, audioKeys: ["audio/u1/cascade.webm"] });

			const remaining = await db
				.select({ id: consultationsTable.id })
				.from(consultationsTable)
				.where(eq(consultationsTable.patientId, patient.id));
			expect(remaining).toEqual([]);
			expect(withAudio).toBeGreaterThan(0);
			expect(plain).toBeGreaterThan(0);
			const patientRows = await db
				.select({ id: patientsTable.id })
				.from(patientsTable)
				.where(eq(patientsTable.id, patient.id));
			expect(patientRows).toEqual([]);
		});

		it("returns null when the patient does not exist", async () => {
			await expect(deleteCascade(424242, "u1")).resolves.toBeNull();
		});

		it("fails Forbidden without a bound principal", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Null Principal")))!;
			await linkedConsultation(patient.id, "u1");
			await expect(deleteCascade(patient.id, null)).rejects.toBeInstanceOf(Forbidden);
		});

		it("fails Forbidden when a linked consultation belongs to someone else", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Mixed")))!;
			await linkedConsultation(patient.id, "u1");
			await linkedConsultation(patient.id, "u2");
			await expect(deleteCascade(patient.id, "u1")).rejects.toBeInstanceOf(Forbidden);
		});

		it("fails Forbidden on ownerless consultation rows", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Ownerless")))!;
			await linkedConsultation(patient.id, null);
			await expect(deleteCascade(patient.id, "u1")).rejects.toBeInstanceOf(Forbidden);
		});
	});
});

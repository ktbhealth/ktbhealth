import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { adminAudit, AUDIT_TEST_DDL, AuditLive } from "@ktb/audit";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Forbidden, Principal } from "@ktb/authz";
import { createPatient, PatientsCommandsLive, PatientsQueriesLive } from "@ktb/patients";
import { validatePatient } from "@ktb/patients/record";
import { patients as patientsTable } from "@ktb/patients/schema";
import { PatientCascadeCommands, PatientRecordConsultationsQueries } from "@ktb/patients/api";
import { makeEventBus, Command, Query } from "@effect-server-utils/cqrs";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { Tenant, type Tenant as TenantScope } from "@ktb/tenant";
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
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER, tenant_id INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL, tenant_id INTEGER);
${AUDIT_TEST_DDL}
`;

const fields = (name: string) => {
	const r = validatePatient({ name, birthDate: "1984-03-05" });
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.fields;
};

describe("patients.* CQRS surface", () => {
	let db: ReturnType<typeof makeDb>;
	let runtime: ManagedRuntime.ManagedRuntime<unknown, never>;

	const run = <A, E, R>(
		principal: { userId: string; email?: string } | null,
		effect: Effect.Effect<A, E, R>,
		tenant?: TenantScope | null,
	) => {
		let eff = effect.pipe(Effect.provideService(Principal, principal)) as Effect.Effect<
			A,
			E,
			never
		>;
		if (tenant !== undefined) eff = Effect.provideService(eff, Tenant, tenant);
		return runtime.runPromise(eff.pipe(Effect.scoped) as Effect.Effect<A, E, never>);
	};

	const TENANT_A: TenantScope = { id: 7, kind: "clinic", slug: "clinica-a", role: "member" };
	const TENANT_B: TenantScope = { id: 8, kind: "clinic", slug: "clinica-b", role: "member" };

	const recordConsultations = (patientId: number, userId: string | null, tenant?: TenantScope) =>
		run(
			userId === null ? null : { userId },
			Effect.gen(function* () {
				const queries = yield* Query.dispatcher(PatientRecordConsultationsQueries);
				return yield* queries["patients.recordConsultations"]({ patientId });
			}),
			tenant,
		);

	const deleteCascade = (
		patientId: number,
		userId: string | null,
		tenant?: TenantScope,
		email?: string,
	) =>
		run(
			userId === null ? null : { userId, email },
			Effect.gen(function* () {
				const commands = yield* Command.dispatcher(PatientCascadeCommands);
				return yield* commands["patients.deleteCascade"]({ patientId });
			}),
			tenant,
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
		const live = Layer.mergeAll(
			PatientRecordConsultationsLive,
			PatientDeleteCascadeLive,
			// T-037: the admin patient-delete path writes admin_audit.
			AuditLive.pipe(Layer.provide(infra)),
		).pipe(Layer.provide(Layer.mergeAll(infra, patientsHandlers)));
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

		it("records a patients.delete audit row for platform-admin deletes only", async () => {
			const patient = (await createPatient(db, "u1", fields("Cascade Admin")))!;
			await linkedConsultation(patient.id, "u1");

			// Owner path — not an admin action, no audit row.
			await deleteCascade(patient.id, "u1");
			let rows = await db.select().from(adminAudit);
			expect(rows.filter((r) => r.action === "patients.delete")).toHaveLength(0);

			// Admin path — cross-owner delete is audited with ids/counts.
			const adminPatient = (await createPatient(db, "u1", fields("Cascade Admin 2")))!;
			await linkedConsultation(adminPatient.id, "u1");
			await linkedConsultation(adminPatient.id, "u2");
			await deleteCascade(adminPatient.id, "admin@x.com", undefined, "admin@x.com");
			rows = await db.select().from(adminAudit);
			const entry = rows.find(
				(r) => r.action === "patients.delete" && r.targetId === String(adminPatient.id),
			);
			expect(entry).toMatchObject({
				actorUserId: "admin@x.com",
				actorEmail: "admin@x.com",
				targetType: "patient",
			});
			expect(entry?.detail).toContain('"ownerId":"u1"');
			expect(entry?.detail).toContain('"consultations":2');
		});
	});

	describe("tenant scope (P-053)", () => {
		/** Consultation row with an explicit tenant_id linked to a patient. */
		const tenantConsultation = async (patientId: number, userId: string, tenantId: number) => {
			const id = (await createConsultation(db, { userId, source: "browser" }, tenantId))!;
			await db.update(consultationsTable).set({ patientId }).where(eq(consultationsTable.id, id));
			return id;
		};

		it("recordConsultations lists tenant rows for members only", async () => {
			const patient = (await createPatient(db, "u1", fields("Tenant Rec"), 7))!;
			const shared = await tenantConsultation(patient.id, "u1", 7);

			// Member of tenant 7 sees the tenant consultation.
			const member = await recordConsultations(patient.id, "u2", TENANT_A);
			expect(member.map((r) => r.id)).toContain(shared);

			// Member of another tenant and personal scope see nothing.
			await expect(recordConsultations(patient.id, "u2", TENANT_B)).resolves.toEqual([]);
			await expect(recordConsultations(patient.id, "u1")).resolves.toEqual([]);
		});

		it("deleteCascade lets a tenant member remove tenant consultations and the patient", async () => {
			const patient = (await createPatient(db, "u1", fields("Tenant Cascade"), 7))!;
			const c1 = await tenantConsultation(patient.id, "u2", 7);
			const c2 = await tenantConsultation(patient.id, "u1", 7);

			const result = await deleteCascade(patient.id, "u2", TENANT_A);
			expect(result?.consultations).toBe(2);

			const remaining = await db
				.select({ id: consultationsTable.id })
				.from(consultationsTable)
				.where(eq(consultationsTable.patientId, patient.id));
			expect(remaining).toEqual([]);
			const patientRows = await db
				.select({ id: patientsTable.id })
				.from(patientsTable)
				.where(eq(patientsTable.id, patient.id));
			expect(patientRows).toEqual([]);
			expect(c1).toBeGreaterThan(0);
			expect(c2).toBeGreaterThan(0);
		});

		it("deleteCascade fails Forbidden for a non-member on tenant rows", async () => {
			const patient = (await createPatient(db, "u1", fields("Tenant Cascade No"), 7))!;
			await tenantConsultation(patient.id, "u1", 7);
			await expect(deleteCascade(patient.id, "u2", TENANT_B)).rejects.toBeInstanceOf(Forbidden);
		});
	});
});

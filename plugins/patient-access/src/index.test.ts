import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { PatientProfiles } from "@ktb/auth";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";

import {
	listPatientProfiles,
	patientAccessRoutesPlugin,
	patientAccessServicesPlugin,
	patientAccessTablesPlugin,
	PatientProfilesLive,
	plugins,
} from "./index.ts";
import { patientAccess } from "./schema.ts";

// parent is the patient "Ana" and guardian of "Leo"; their CPF match on
// "Rui" is still pending, the invite to "Eva" unclaimed and the link to
// "Ivo" revoked.
const DDL = `
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL);
INSERT INTO patients (id, owner_id, name) VALUES
  (1, 'doc', 'Leo'), (2, 'doc', 'Ana'), (3, 'doc', 'Rui'), (4, 'doc', 'Eva'), (5, 'doc', 'Ivo');
CREATE TABLE patient_access (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL, user_id TEXT, email TEXT, relation TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, granted_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO patient_access (patient_id, user_id, email, relation, status, source, created_at, updated_at) VALUES
  (1, 'parent', NULL, 'guardian', 'active', 'invite', 0, 0),
  (2, 'parent', NULL, 'self', 'active', 'cpf', 0, 0),
  (3, 'parent', NULL, 'self', 'pending', 'cpf', 0, 0),
  (4, NULL, 'parent@ktb.test', 'guardian', 'invited', 'invite', 0, 0),
  (5, 'parent', NULL, 'guardian', 'revoked', 'invite', 0, 0);
`;

describe("listPatientProfiles", () => {
	const db = makeDb(makeD1(DDL));

	it("returns only actively linked records, by name", async () => {
		expect(await listPatientProfiles(db, "parent")).toEqual([
			{ patientId: 2, name: "Ana", relation: "self" },
			{ patientId: 1, name: "Leo", relation: "guardian" },
		]);
	});

	it("returns nothing for a user with no patient link", async () => {
		expect(await listPatientProfiles(db, "stranger")).toEqual([]);
	});
});

describe("PatientProfilesLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<PatientProfiles, never>;
	const d1 = makeD1(DDL);

	beforeAll(() => {
		runtime = ManagedRuntime.make(
			PatientProfilesLive.pipe(Layer.provide(Layer.succeed(Db, makeDb(d1)))),
		);
	});

	afterAll(() => runtime.dispose());

	it("re-reads the links on every call, so a revocation applies at once", async () => {
		const listFor = (userId: string) =>
			runtime.runPromise(Effect.flatMap(PatientProfiles, (directory) => directory.listFor(userId)));
		expect((await listFor("parent")).map((p) => p.patientId)).toEqual([2, 1]);
		await makeDb(d1).update(patientAccess).set({ status: "revoked" });
		expect(await listFor("parent")).toEqual([]);
	});
});

describe("patient-access plugins", () => {
	it("contributes the patient_access table, its services and the doctor-side route", () => {
		expect(plugins).toEqual([
			patientAccessTablesPlugin,
			patientAccessServicesPlugin,
			patientAccessRoutesPlugin,
		]);
		expect(patientAccessTablesPlugin.id).toBe("patient-access.tables");
		expect(patientAccessTablesPlugin.tables.patientAccess).toBe(patientAccess);
		expect(patientAccessServicesPlugin.id).toBe("patient-access.services");
		expect(patientAccessRoutesPlugin.id).toBe("patient-access.routes");
		expect(patientAccessRoutesPlugin.routes).toHaveLength(1);
	});
});

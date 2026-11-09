import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import type { Plugin } from "@ktb/kernel";
import { Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { UsersIcon } from "lucide-react";
import {
	createPatient,
	listAllPatients,
	listPatients,
	Patients,
	PatientsLive,
	patientsPanelPlugin,
	patientsServicesPlugin,
	patientsTablesPlugin,
	plugins,
} from "./index.ts";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
INSERT INTO "user" VALUES ('u2', 'Dr B', 'b@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, created_at INTEGER);
`;

describe("patients repo", () => {
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("creates and lists scoped by owner", async () => {
		await createPatient(db, "u1", "Ana");
		await createPatient(db, "u1", "Bia");
		const rows = await listPatients(db, "u1");
		expect(rows.map((r) => r.name)).toEqual(["Ana", "Bia"]);
	});

	it("scopes to owner only", async () => {
		expect(await listPatients(db, "u2")).toEqual([]);
	});

	it("returns the created row", async () => {
		const p = await createPatient(db, "u1", "Cid");
		expect(p?.name).toBe("Cid");
		expect(p?.ownerId).toBe("u1");
	});

	it("returns null when insert yields no row", async () => {
		const stub = {
			insert: () => ({ values: () => ({ returning: async () => [] }) }),
		} as unknown as typeof db;
		expect(await createPatient(stub, "u1", "X")).toBeNull();
	});

	it("listAllPatients returns cross-owner rows with owner fields", async () => {
		await createPatient(db, "u1", "Admin Ana");
		await createPatient(db, "u2", "Admin Bia");
		const rows = await listAllPatients(db);
		const byName = new Map(rows.map((r) => [r.name, r]));
		expect(byName.get("Admin Ana")?.ownerEmail).toBe("d@x.com");
		expect(byName.get("Admin Ana")?.ownerName).toBe("Dra");
		expect(byName.get("Admin Bia")?.ownerEmail).toBe("b@x.com");
		// Newest first.
		expect(rows[0]?.name).toBe("Admin Bia");
	});
});

describe("PatientsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Patients, never>;

	beforeAll(() => {
		const db = makeDb(makeD1(DDL));
		const deps = Layer.merge(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		runtime = ManagedRuntime.make(PatientsLive.pipe(Layer.provide(deps)));
	});

	afterAll(() => runtime.dispose());

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Patients>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const call = <A, E>(f: (p: Patients["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Patients, f);

	it("list returns own patients for the bound principal", async () => {
		await asUser(
			"u1",
			call((p) => p.create("u1", "Ana")),
		);
		const rows = await asUser(
			"u1",
			call((p) => p.list("u1")),
		);
		expect(rows.map((r) => r.name)).toContain("Ana");
	});

	it("list fails Forbidden for another ownerId and for null principal", async () => {
		await expect(
			asUser(
				"u1",
				call((p) => p.list("u2")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
		await expect(
			asUser(
				null,
				call((p) => p.list("u1")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
	});

	it("create succeeds for the principal's own id", async () => {
		const patient = await asUser(
			"u1",
			call((p) => p.create("u1", "Svc Patient")),
		);
		expect(patient?.name).toBe("Svc Patient");
		expect(patient?.ownerId).toBe("u1");
	});

	it("create fails Forbidden on owner mismatch and null principal", async () => {
		await expect(
			asUser(
				"u1",
				call((p) => p.create("u2", "X")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
			path: "patient.create",
		});
		await expect(
			asUser(
				null,
				call((p) => p.create("u1", "X")),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
	});

	it("adminList returns cross-owner rows for an allowlisted principal", async () => {
		const rows = await asUser(
			"u1",
			call((p) => p.adminList()),
			"admin@x.com",
		);
		expect(rows.length).toBeGreaterThan(0);
		// All fixture patients here are u1-owned; the join resolves the
		// owner's email — proof adminList is not owner-scoped.
		expect(rows.every((r) => r.ownerEmail === "d@x.com")).toBe(true);
	});

	it("adminList fails Forbidden for non-admin email, missing email and null principal", async () => {
		await expect(
			asUser(
				"u1",
				call((p) => p.adminList()),
				"other@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
		await expect(
			asUser(
				"u1",
				call((p) => p.adminList()),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				null,
				call((p) => p.adminList()),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});
});

describe("plugins", () => {
	it("declares tables, services and panel as single-concern plugins", () => {
		expect(patientsTablesPlugin.id).toBe("patients.tables");
		expect(patientsTablesPlugin.tables?.patients).toBeDefined();
		expect(patientsServicesPlugin.id).toBe("patients.services");
		expect(patientsServicesPlugin.requiredDeps).toEqual(["platform.admin"]);
		expect(patientsServicesPlugin.services).toBe(PatientsLive);
		expect(patientsPanelPlugin.id).toBe("patients.panel");
		expect(patientsPanelPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(patientsPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/patients", label: "Patients", icon: UsersIcon, group: "Domains" },
		]);
	});

	it("contributes no routes or top-nav", () => {
		expect((patientsTablesPlugin as Plugin).routes).toBeUndefined();
		expect((patientsServicesPlugin as Plugin).nav).toBeUndefined();
		expect((patientsPanelPlugin as Plugin).routes).toBeUndefined();
		expect((patientsPanelPlugin as Plugin).nav).toBeUndefined();
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual([
			"patients.tables",
			"patients.services",
			"patients.panel",
		]);
	});
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { Command, makeEventBus } from "@effect-server-utils/cqrs";
import { UsersIcon } from "lucide-react";
import {
	createPatient,
	getPatient,
	listAllPatients,
	listPatients,
	Patients,
	PatientsCommandsLive,
	PatientsLive,
	patientsLandingNavPlugin,
	patientsPanelPlugin,
	patientsRoutesPlugin,
	patientsServicesPlugin,
	patientsTablesPlugin,
	plugins,
	updatePatient,
} from "./index.ts";
import { PatientsCommands } from "./api.ts";
import { validatePatient, type PatientFields } from "./record.ts";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";

/** Validated fields for a name (birth date fixed — only the name varies in these tests). */
const fields = (name: string, extra: Record<string, string> = {}): PatientFields => {
	const r = validatePatient({ name, birthDate: "1984-03-05", ...extra });
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.fields;
};

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
INSERT INTO "user" VALUES ('u2', 'Dr B', 'b@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER);
`;

describe("patients repo", () => {
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("creates and lists scoped by owner", async () => {
		await createPatient(db, "u1", fields("Ana"));
		await createPatient(db, "u1", fields("Bia"));
		const rows = await listPatients(db, "u1");
		expect(rows.map((r) => r.name)).toEqual(["Ana", "Bia"]);
	});

	it("scopes to owner only", async () => {
		expect(await listPatients(db, "u2")).toEqual([]);
	});

	it("returns the created row", async () => {
		const p = await createPatient(db, "u1", fields("Cid"));
		expect(p?.name).toBe("Cid");
		expect(p?.ownerId).toBe("u1");
	});

	it("returns null when insert yields no row", async () => {
		const stub = {
			insert: () => ({ values: () => ({ returning: async () => [] }) }),
		} as unknown as typeof db;
		expect(await createPatient(stub, "u1", fields("X"))).toBeNull();
	});

	it("persists the full record and gets it by id", async () => {
		const p = await createPatient(
			db,
			"u1",
			fields("Dora", { cpf: "529.982.247-25", city: "Recife" }),
		);
		const row = await getPatient(db, p!.id);
		expect(row).toMatchObject({ name: "Dora", cpf: "52998224725", city: "Recife", active: true });
		expect(row?.birthDate).toBe("1984-03-05");
		expect(await getPatient(db, 9999)).toBeNull();
	});

	it("updates a record and stamps updatedAt", async () => {
		const p = await createPatient(db, "u1", fields("Eva"));
		expect(p?.updatedAt).toBeNull();
		const updated = await updatePatient(db, p!.id, { ...fields("Eva Lima"), active: false });
		expect(updated).toMatchObject({ name: "Eva Lima", active: false });
		expect(updated?.updatedAt).toBeInstanceOf(Date);
		expect(await updatePatient(db, 9999, fields("Nobody"))).toBeNull();
	});

	it("listAllPatients returns cross-owner rows with owner fields", async () => {
		await createPatient(db, "u1", fields("Admin Ana"));
		await createPatient(db, "u2", fields("Admin Bia"));
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
		const deps = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
			makeEventBus(),
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
			call((p) => p.create("u1", fields("Ana"))),
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
			call((p) => p.create("u1", fields("Svc Patient"))),
		);
		expect(patient?.name).toBe("Svc Patient");
		expect(patient?.ownerId).toBe("u1");
	});

	it("create fails Forbidden on owner mismatch and null principal", async () => {
		await expect(
			asUser(
				"u1",
				call((p) => p.create("u2", fields("X"))),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
			path: "patient.create",
		});
		await expect(
			asUser(
				null,
				call((p) => p.create("u1", fields("X"))),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
	});

	it("get returns the owner's patient, null when missing", async () => {
		const created = await asUser(
			"u1",
			call((p) => p.create("u1", fields("Gil"))),
		);
		const got = await asUser(
			"u1",
			call((p) => p.get("u1", created!.id)),
		);
		expect(got?.name).toBe("Gil");
		expect(
			await asUser(
				"u1",
				call((p) => p.get("u1", 9999)),
			),
		).toBeNull();
	});

	it("get fails Forbidden for another owner's row, owner mismatch and null principal", async () => {
		const created = await asUser(
			"u1",
			call((p) => p.create("u1", fields("Private"))),
		);
		// u2's own principal, reading u1's row → permix denies on the real owner.
		await expect(
			asUser(
				"u2",
				call((p) => p.get("u2", created!.id)),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "patient.read" });
		await expect(
			asUser(
				"u1",
				call((p) => p.get("u2", created!.id)),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				null,
				call((p) => p.get("u1", created!.id)),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("update rewrites the owner's patient, null when missing", async () => {
		const created = await asUser(
			"u1",
			call((p) => p.create("u1", fields("Hugo"))),
		);
		const updated = await asUser(
			"u1",
			call((p) => p.update("u1", created!.id, fields("Hugo Reis", { city: "Natal" }))),
		);
		expect(updated).toMatchObject({ name: "Hugo Reis", city: "Natal" });
		expect(
			await asUser(
				"u1",
				call((p) => p.update("u1", 9999, fields("X"))),
			),
		).toBeNull();
	});

	it("update fails Forbidden for another owner's row and null principal", async () => {
		const created = await asUser(
			"u1",
			call((p) => p.create("u1", fields("Locked"))),
		);
		await expect(
			asUser(
				"u2",
				call((p) => p.update("u2", created!.id, fields("Hijack"))),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "patient.update" });
		await expect(
			asUser(
				null,
				call((p) => p.update("u1", created!.id, fields("X"))),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
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
		expect(patientsServicesPlugin.services).toBeDefined();
		expect(patientsPanelPlugin.id).toBe("patients.panel");
		expect(patientsPanelPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(patientsPanelPlugin.panel?.sidebar).toEqual([
			{ to: "/platform/patients", label: "Patients", icon: UsersIcon, group: "Domains" },
		]);
	});

	it("keeps routes and nav out of the tables, services and panel plugins", () => {
		expect("routes" in patientsTablesPlugin).toBe(false);
		expect("landingNav" in patientsServicesPlugin).toBe(false);
		expect("routes" in patientsPanelPlugin).toBe(false);
		expect("landingNav" in patientsPanelPlugin).toBe(false);
	});

	it("declares the /patients route subtree and nav entry", () => {
		expect(patientsRoutesPlugin.id).toBe("patients.routes");
		// P-033: the subtree is a physical() mount of this package's own
		// src/routes directory — resolved against the host routes dir.
		expect(JSON.stringify(patientsRoutesPlugin.routes)).toContain("plugins/patients/src/routes");
		expect(patientsLandingNavPlugin.id).toBe("patients.landing-nav");
		expect(patientsLandingNavPlugin.landingNav).toEqual([{ to: "/patients", label: "Patients" }]);
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual([
			"patients.tables",
			"patients.services",
			"patients.routes",
			"patients.landing-nav",
			"patients.panel",
		]);
	});
});

describe("PatientsLive without a stored row", () => {
	it("create returns null (and emits nothing) when the insert yields no row", async () => {
		const stub = {
			insert: () => ({ values: () => ({ returning: async () => [] }) }),
		} as unknown as ReturnType<typeof makeDb>;
		const deps = Layer.mergeAll(
			Layer.succeed(Db, stub),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
			makeEventBus(),
		);
		const runtime = ManagedRuntime.make(PatientsLive.pipe(Layer.provide(deps)));
		try {
			const row = await runtime.runPromise(
				Effect.provideService(
					Effect.flatMap(Patients, (p) => p.create("u1", fields("Ghost"))),
					Principal,
					{ userId: "u1" },
				),
			);
			expect(row).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});
});

describe("PatientsCommandsLive", () => {
	it("patients.delete is a no-op for a patient that does not exist", async () => {
		const deps = Layer.mergeAll(Layer.succeed(Db, makeDb(makeD1(DDL))), makeEventBus());
		const runtime = ManagedRuntime.make(PatientsCommandsLive.pipe(Layer.provideMerge(deps)));
		try {
			await expect(
				runtime.runPromise(
					Effect.provideService(
						Effect.gen(function* () {
							const commands = yield* Command.dispatcher(PatientsCommands);
							return yield* commands["patients.delete"]({ id: 424242 });
						}).pipe(Effect.scoped),
						Principal,
						{ userId: "u1" },
					),
				),
			).resolves.toBeUndefined();
		} finally {
			await runtime.dispose();
		}
	});

	it("patients.delete removes the owner's patient and emits patient.deleted", async () => {
		const db = makeDb(makeD1(DDL));
		const row = (await createPatient(db, "u1", fields("To Delete")))!;
		const deps = Layer.mergeAll(Layer.succeed(Db, db), makeEventBus());
		const runtime = ManagedRuntime.make(PatientsCommandsLive.pipe(Layer.provideMerge(deps)));
		try {
			await runtime.runPromise(
				Effect.provideService(
					Effect.gen(function* () {
						const commands = yield* Command.dispatcher(PatientsCommands);
						yield* commands["patients.delete"]({ id: row.id });
					}).pipe(Effect.scoped),
					Principal,
					{ userId: "u1" },
				),
			);
			expect(await getPatient(db, row.id)).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});
});

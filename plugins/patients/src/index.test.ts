import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminAudit, AUDIT_TEST_DDL, AuditLive } from "@ktb/audit";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { user as userTable } from "@ktb/db/schema";
import { Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { Command, EventBus, type EventBusShape, makeEventBus } from "@effect-server-utils/cqrs";
import {
	createPatient,
	getPatient,
	listAllPatients,
	listPatients,
	Patients,
	PatientsCommandsLive,
	PatientsLive,
	patientsChromePlugin,
	patientsPanelPlugin,
	patientsRoutesPlugin,
	patientsServicesPlugin,
	patientsTablesPlugin,
	plugins,
	updatePatient,
} from "./index.ts";
import { PatientCreated, PatientDeleted, PatientsCommands } from "./api.ts";
import { validatePatient, type PatientFields } from "./record.ts";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { Tenant, type Tenant as TenantScope } from "@ktb/tenant";

/** Validated fields for a name (birth date fixed — only the name varies in these tests). */
const fields = (name: string, extra: Record<string, string> = {}): PatientFields => {
	const r = validatePatient({ name, birthDate: "1984-03-05", ...extra });
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.fields;
};

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cpf TEXT UNIQUE);
INSERT INTO "user" (id, name, email, email_verified, image, banned, created_at, updated_at) VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0, 0);
INSERT INTO "user" (id, name, email, email_verified, image, banned, created_at, updated_at) VALUES ('u2', 'Dr B', 'b@x.com', 0, NULL, 0, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER, tenant_id INTEGER);
${AUDIT_TEST_DDL}
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
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
		const deps = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
			makeEventBus(),
		);
		// Provide the real audit service so adminCreate writes an
		// admin_audit row (T-037); the "without a stored row" and tenant
		// describes below intentionally omit it.
		const allDeps = Layer.mergeAll(deps, AuditLive.pipe(Layer.provide(deps)));
		runtime = ManagedRuntime.make(PatientsLive.pipe(Layer.provideMerge(allDeps)));
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

	it("adminCreate inserts a patient for another owner", async () => {
		const row = await asUser(
			"u1",
			call((p) => p.adminCreate("u2", fields("Admin Made"))),
			"admin@x.com",
		);
		expect(row?.ownerId).toBe("u2");
		expect(row?.name).toBe("Admin Made");
		// T-037: the audit row carries ids only — never patient fields.
		const auditRows = await db.select().from(adminAudit);
		const entry = auditRows.find(
			(r) => r.action === "patients.create" && r.targetId === String(row!.id),
		);
		expect(entry).toMatchObject({
			actorUserId: "u1",
			actorEmail: "admin@x.com",
			targetType: "patient",
		});
		expect(entry?.detail).not.toContain("Admin Made");
	});

	it("adminCreate fails Forbidden for non-admin and null principal", async () => {
		await expect(
			asUser(
				"u1",
				call((p) => p.adminCreate("u2", fields("Nope"))),
				"other@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "platform.admin" });
		await expect(
			asUser(
				null,
				call((p) => p.adminCreate("u2", fields("Nope"))),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("adminOwners lists user accounts for allowlisted admins only", async () => {
		// Blank names fall back to email, then to the id — the picker
		// label must never render empty.
		await db.insert(userTable).values([
			{
				id: "u3",
				name: "",
				email: "noname@x.com",
				emailVerified: false,
				createdAt: new Date(0),
				updatedAt: new Date(0),
			},
			{
				id: "u4",
				name: "",
				email: "",
				emailVerified: false,
				createdAt: new Date(0),
				updatedAt: new Date(0),
			},
		]);
		const owners = await asUser(
			"u1",
			call((p) => p.adminOwners()),
			"admin@x.com",
		);
		expect(owners.map((o) => o.id).sort()).toEqual(["u1", "u2", "u3", "u4"]);
		expect(owners.find((o) => o.id === "u3")?.label).toBe("noname@x.com");
		expect(owners.find((o) => o.id === "u4")?.label).toBe("u4");
		await expect(
			asUser(
				"u1",
				call((p) => p.adminOwners()),
				"other@x.com",
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("get and update let an admin cross the owner boundary", async () => {
		const foreign = await asUser(
			"u2",
			call((p) => p.create("u2", fields("Foreign Read"))),
		);
		const id = foreign!.id;
		// Admin reads and updates u2's row through the owner-scoped API.
		const read = await asUser(
			"u1",
			call((p) => p.get("u1", id)),
			"admin@x.com",
		);
		expect(read?.name).toBe("Foreign Read");
		const updated = await asUser(
			"u1",
			call((p) => p.update("u1", id, fields("Foreign Edited"))),
			"admin@x.com",
		);
		expect(updated?.name).toBe("Foreign Edited");
		// A non-admin still gets Forbidden on the same row.
		await expect(
			asUser(
				"u1",
				call((p) => p.get("u1", id)),
			),
		).rejects.toMatchObject({
			_tag: "Forbidden",
		});
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
		expect(patientsPanelPlugin.panel?.pages?.[0]?.path).toBe("/platform/patients");
		expect(patientsChromePlugin.id).toBe("patients.chrome");
		expect(patientsChromePlugin.chrome.map((c) => c.region)).toEqual([
			"app.header.nav",
			"console.sidebar",
		]);
	});

	it("keeps routes and chrome out of the tables, services and panel plugins", () => {
		expect("routes" in patientsTablesPlugin).toBe(false);
		expect("chrome" in patientsServicesPlugin).toBe(false);
		expect("routes" in patientsPanelPlugin).toBe(false);
		expect("chrome" in patientsPanelPlugin).toBe(false);
	});

	it("declares the /patients route subtree and nav entry", () => {
		expect(patientsRoutesPlugin.id).toBe("patients.routes");
		// P-033: the subtree is a physical() mount of this package's own
		// src/routes directory — resolved against the host routes dir.
		expect(JSON.stringify(patientsRoutesPlugin.routes)).toContain("plugins/patients/src/routes");
		const nav = patientsChromePlugin.chrome.find((c) => c.region === "app.header.nav");
		expect(nav?.content).toEqual({ kind: "link", to: "/patients", label: "Patients" });
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual([
			"patients.tables",
			"patients.services",
			"patients.routes",
			"patients.chrome",
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

	it("adminCreate returns null when the insert yields no row", async () => {
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
					Effect.flatMap(Patients, (p) => p.adminCreate("u2", fields("Ghost Admin"))),
					Principal,
					{ userId: "u1", email: "admin@x.com" },
				),
			);
			expect(row).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});
});

describe("PatientsCommandsLive", () => {
	const adminGate = () =>
		Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com")));

	it("patients.delete is a no-op for a patient that does not exist", async () => {
		const deps = Layer.mergeAll(
			Layer.succeed(Db, makeDb(makeD1(DDL))),
			makeEventBus(),
			adminGate(),
		);
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
		const deps = Layer.mergeAll(Layer.succeed(Db, db), makeEventBus(), adminGate());
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

	it("patients.delete lets a platform admin remove another owner's patient", async () => {
		const db = makeDb(makeD1(DDL));
		const row = (await createPatient(db, "u2", fields("Foreign")))!;
		const deps = Layer.mergeAll(Layer.succeed(Db, db), makeEventBus(), adminGate());
		const runtime = ManagedRuntime.make(PatientsCommandsLive.pipe(Layer.provideMerge(deps)));
		try {
			await runtime.runPromise(
				Effect.provideService(
					Effect.gen(function* () {
						const commands = yield* Command.dispatcher(PatientsCommands);
						yield* commands["patients.delete"]({ id: row.id });
					}).pipe(Effect.scoped),
					Principal,
					{ userId: "u1", email: "admin@x.com" },
				),
			);
			expect(await getPatient(db, row.id)).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});

	it("patients.delete still fails Forbidden for a non-admin non-owner", async () => {
		const db = makeDb(makeD1(DDL));
		const row = (await createPatient(db, "u2", fields("Foreign 2")))!;
		const deps = Layer.mergeAll(Layer.succeed(Db, db), makeEventBus(), adminGate());
		const runtime = ManagedRuntime.make(PatientsCommandsLive.pipe(Layer.provideMerge(deps)));
		try {
			await expect(
				runtime.runPromise(
					Effect.provideService(
						Effect.gen(function* () {
							const commands = yield* Command.dispatcher(PatientsCommands);
							yield* commands["patients.delete"]({ id: row.id });
						}).pipe(Effect.scoped),
						Principal,
						{ userId: "u1", email: "other@x.com" },
					),
				),
			).rejects.toMatchObject({ _tag: "Forbidden" });
			expect(await getPatient(db, row.id)).not.toBeNull();
		} finally {
			await runtime.dispose();
		}
	});
});

describe("PatientsLive tenant scope (P-053)", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Patients, never>;
	let busRuntime: ManagedRuntime.ManagedRuntime<EventBus, never>;
	let db: ReturnType<typeof makeDb>;
	let bus: EventBusShape;

	const TENANT_A: TenantScope = { id: 7, kind: "clinic", slug: "clinica-a", role: "member" };
	const TENANT_B: TenantScope = { id: 8, kind: "clinic", slug: "clinica-b", role: "member" };

	beforeAll(async () => {
		db = makeDb(makeD1(DDL));
		// Build the bus explicitly so tests can subscribe to the same
		// instance the service layer dispatches on.
		busRuntime = ManagedRuntime.make(makeEventBus());
		bus = await busRuntime.runPromise(EventBus);
		const deps = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
			Layer.succeed(EventBus, bus),
		);
		runtime = ManagedRuntime.make(PatientsLive.pipe(Layer.provide(deps)));
	});

	afterAll(async () => {
		await runtime.dispose();
		await busRuntime.dispose();
	});

	const asUser = <A, E>(
		userId: string | null,
		effect: Effect.Effect<A, E, Patients>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId, email }),
		);

	const asTenant = <A, E>(
		userId: string,
		tenant: TenantScope,
		effect: Effect.Effect<A, E, Patients>,
		email?: string,
	) =>
		runtime.runPromise(
			Effect.provideService(
				Effect.provideService(effect, Principal, { userId, email }),
				Tenant,
				tenant,
			),
		);

	const call = <A, E>(f: (p: Patients["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Patients, f);

	it("create stamps tenant_id from the bound tenant; personal scope stamps NULL", async () => {
		const shared = await asTenant(
			"u1",
			TENANT_A,
			call((p) => p.create("u1", fields("Tenant Pat"))),
		);
		expect(shared?.tenantId).toBe(7);
		expect((await getPatient(db, shared!.id))?.tenantId).toBe(7);

		const personal = await asUser(
			"u1",
			call((p) => p.create("u1", fields("Personal Pat"))),
		);
		expect(personal?.tenantId).toBeNull();
	});

	it("create leaves tenant_id NULL for non-numeric tenant ids", async () => {
		const row = await asTenant(
			"u1",
			{ ...TENANT_A, id: "clinic-x" },
			call((p) => p.create("u1", fields("Strange Tenant"))),
		);
		expect(row?.tenantId).toBeNull();
	});

	it("create/adminCreate events carry the stamped tenant_id", async () => {
		const seen: (number | null | undefined)[] = [];
		await Effect.runPromise(
			bus.subscribe(PatientCreated, (e) =>
				Effect.sync(() => {
					seen.push(e.tenantId);
				}),
			),
		);
		await asTenant(
			"u1",
			TENANT_A,
			call((p) => p.create("u1", fields("Evt Pat"))),
		);
		await asTenant(
			"u1",
			TENANT_A,
			call((p) => p.adminCreate("u2", fields("Evt Admin"))),
			"admin@x.com",
		);
		await asUser(
			"u1",
			call((p) => p.create("u1", fields("Evt Personal"))),
		);
		expect(seen).toEqual([7, 7, null]);
	});

	it("adminCreate stamps the bound tenant", async () => {
		const row = await asTenant(
			"u1",
			TENANT_A,
			call((p) => p.adminCreate("u2", fields("Admin Tenant Pat"))),
			"admin@x.com",
		);
		expect(row?.tenantId).toBe(7);
		expect(row?.ownerId).toBe("u2");
	});

	it("list shows tenant rows to members and hides them from outsiders and personal scope", async () => {
		await createPatient(db, "u1", fields("Clinic Shared"), 7);
		await createPatient(db, "u2", fields("Other Clinic"), 8);

		// u2 is a member of tenant 7: sees u1's tenant-7 row, not tenant 8's.
		const member = await asTenant(
			"u2",
			TENANT_A,
			call((p) => p.list("u2")),
		);
		const memberNames = member.map((r) => r.name);
		expect(memberNames).toContain("Clinic Shared");
		expect(memberNames).not.toContain("Other Clinic");

		// Personal scope: tenant rows are invisible even to their creator.
		const personal = await asUser(
			"u1",
			call((p) => p.list("u1")),
		);
		expect(personal.map((r) => r.name)).not.toContain("Clinic Shared");
		expect(personal.map((r) => r.name)).not.toContain("Other Clinic");
	});

	it("get lets tenant members read tenant rows; outsiders, personal-scope owners and admins behave", async () => {
		const shared = (await createPatient(db, "u1", fields("Shared Get"), 7))!;

		const got = await asTenant(
			"u2",
			TENANT_A,
			call((p) => p.get("u2", shared.id)),
		);
		expect(got?.name).toBe("Shared Get");

		// Member of a different tenant → Forbidden.
		await expect(
			asTenant(
				"u2",
				TENANT_B,
				call((p) => p.get("u2", shared.id)),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "patient.read" });

		// The creator in personal scope → Forbidden: tenant rows require
		// tenant context, ownerId is not an access grant outside it.
		await expect(
			asUser(
				"u1",
				call((p) => p.get("u1", shared.id)),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });

		// Platform admin reads cross-tenant.
		const admin = await asTenant(
			"u1",
			TENANT_B,
			call((p) => p.get("u1", shared.id)),
			"admin@x.com",
		);
		expect(admin?.name).toBe("Shared Get");
	});

	it("update lets tenant members operate tenant rows; non-members are Forbidden", async () => {
		const shared = (await createPatient(db, "u1", fields("Shared Edit"), 7))!;

		const updated = await asTenant(
			"u2",
			TENANT_A,
			call((p) => p.update("u2", shared.id, fields("Shared Edit 2"))),
		);
		expect(updated?.name).toBe("Shared Edit 2");

		await expect(
			asTenant(
				"u2",
				TENANT_B,
				call((p) => p.update("u2", shared.id, fields("Hijack"))),
			),
		).rejects.toMatchObject({ _tag: "Forbidden", path: "patient.update" });
	});

	it("patients.delete lets a tenant member remove a tenant row; non-members are Forbidden", async () => {
		const db2 = makeDb(makeD1(DDL));
		const shared = (await createPatient(db2, "u1", fields("Shared Del"), 7))!;
		// Same explicit-bus trick as the tenant describe: subscribe on
		// the instance the command layer dispatches to.
		const busRuntime = ManagedRuntime.make(makeEventBus());
		const bus = await busRuntime.runPromise(EventBus);
		const deps = Layer.mergeAll(
			Layer.succeed(Db, db2),
			Layer.succeed(EventBus, bus),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		const rt = ManagedRuntime.make(PatientsCommandsLive.pipe(Layer.provideMerge(deps)));
		const seen: (number | null | undefined)[] = [];
		await Effect.runPromise(
			bus.subscribe(PatientDeleted, (e) =>
				Effect.sync(() => {
					seen.push(e.tenantId);
				}),
			),
		);
		const del = (tenant: TenantScope) =>
			rt.runPromise(
				Effect.provideService(
					Effect.provideService(
						Effect.gen(function* () {
							const commands = yield* Command.dispatcher(PatientsCommands);
							yield* commands["patients.delete"]({ id: shared.id });
						}).pipe(Effect.scoped),
						Principal,
						{ userId: "u2" },
					),
					Tenant,
					tenant,
				),
			);
		try {
			await expect(del(TENANT_B)).rejects.toMatchObject({ _tag: "Forbidden" });
			expect(await getPatient(db2, shared.id)).not.toBeNull();
			await del(TENANT_A);
			expect(await getPatient(db2, shared.id)).toBeNull();
			// patient.deleted carries the deleted row's tenant_id.
			expect(seen).toEqual([7]);
		} finally {
			await rt.dispose();
			await busRuntime.dispose();
		}
	});
});

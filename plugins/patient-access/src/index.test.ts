import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { PatientProfiles } from "@ktb/auth";
import { Principal } from "@ktb/authz";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { asc, eq } from "drizzle-orm";

import {
	claimPatientInvites,
	invitePatientAccess,
	listPatientLinks,
	listPatientProfiles,
	normalizeEmail,
	patientAccessRoutesPlugin,
	patientAccessServicesPlugin,
	patientAccessTablesPlugin,
	PatientLinks,
	PatientLinksLive,
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

// The doctor "doc" owns Ana (1) and Leo (2); Rui (3) is another doctor's.
// The verified account "ana" is invited to Ana and — as guardian — to
// Leo, where its older CPF match still awaits approval; "leo" has not
// verified the address its invite went to.
const LINKS_DDL = `
CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0);
INSERT INTO user (id, email, email_verified) VALUES
  ('ana', 'Ana@KTB.test', 1), ('leo', 'leo@ktb.test', 0), ('eva', 'eva@ktb.test', 1);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL);
INSERT INTO patients (id, owner_id, name) VALUES (1, 'doc', 'Ana'), (2, 'doc', 'Leo'), (3, 'other', 'Rui');
CREATE TABLE patient_access (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL, user_id TEXT, email TEXT, relation TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, granted_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX patient_access_patient_user_idx ON patient_access (patient_id, user_id);
INSERT INTO patient_access (id, patient_id, user_id, email, relation, status, source, granted_by, created_at, updated_at) VALUES
  (1, 1, NULL, 'ana@ktb.test', 'self', 'invited', 'invite', 'doc', 0, 0),
  (2, 2, 'ana', NULL, 'self', 'pending', 'cpf', NULL, 0, 0),
  (3, 2, NULL, 'ana@ktb.test', 'guardian', 'invited', 'invite', 'sec', 0, 0),
  (4, 3, NULL, 'leo@ktb.test', 'self', 'invited', 'invite', 'other', 0, 0);
`;
const linksDb = () => makeDb(makeD1(LINKS_DDL));
type TestDb = ReturnType<typeof linksDb>;

/** The stored rows of a patient, oldest first, without the timestamps. */
const rowsOf = async (db: TestDb, patientId: number) =>
	(
		await db
			.select()
			.from(patientAccess)
			.where(eq(patientAccess.patientId, patientId))
			.orderBy(asc(patientAccess.id))
	).map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...row }) => row);

describe("normalizeEmail", () => {
	it("trims and lowercases", () => {
		expect(normalizeEmail("  Ana@KTB.test ")).toBe("ana@ktb.test");
	});
});

describe("claimPatientInvites", () => {
	it("claims nothing for an unknown account or an unverified email", async () => {
		const db = linksDb();
		expect(await claimPatientInvites(db, "ghost")).toBe(0);
		expect(await claimPatientInvites(db, "leo")).toBe(0);
		expect(await rowsOf(db, 3)).toMatchObject([{ id: 4, userId: null, status: "invited" }]);
		expect(await listPatientProfiles(db, "leo")).toEqual([]);
	});

	it("activates the invites addressed to the verified email, whatever its case", async () => {
		const db = linksDb();
		expect(await claimPatientInvites(db, "ana")).toBe(2);
		expect(await rowsOf(db, 1)).toEqual([
			{
				id: 1,
				patientId: 1,
				userId: "ana",
				email: "ana@ktb.test",
				relation: "self",
				status: "active",
				source: "invite",
				grantedBy: "doc",
			},
		]);
		expect(await listPatientProfiles(db, "ana")).toEqual([
			{ patientId: 1, name: "Ana", relation: "self" },
			{ patientId: 2, name: "Leo", relation: "guardian" },
		]);
		// Nothing is left to claim, and other people's invites are untouched.
		expect(await claimPatientInvites(db, "ana")).toBe(0);
		expect(await rowsOf(db, 3)).toMatchObject([{ id: 4, userId: null, status: "invited" }]);
	});

	it("upgrades a link the account already holds instead of duplicating it", async () => {
		const db = linksDb();
		await claimPatientInvites(db, "ana");
		// The pending CPF match took over the invite's terms; the invite is gone.
		expect(await rowsOf(db, 2)).toEqual([
			{
				id: 2,
				patientId: 2,
				userId: "ana",
				email: null,
				relation: "guardian",
				status: "active",
				source: "invite",
				grantedBy: "sec",
			},
		]);
	});
});

describe("listPatientLinks", () => {
	it("lists a patient's links, oldest first, under the account or invite address", async () => {
		const db = linksDb();
		expect(await listPatientLinks(db, 2)).toEqual([
			{ id: 2, email: "Ana@KTB.test", relation: "self", status: "pending", source: "cpf" },
			{ id: 3, email: "ana@ktb.test", relation: "guardian", status: "invited", source: "invite" },
		]);
		expect(await listPatientLinks(db, 99)).toEqual([]);
	});

	it("leaves revoked links out and tolerates a link with no address", async () => {
		const db = linksDb();
		await db.update(patientAccess).set({ status: "revoked" }).where(eq(patientAccess.id, 2));
		await db.update(patientAccess).set({ email: null }).where(eq(patientAccess.id, 3));
		expect(await listPatientLinks(db, 2)).toEqual([
			{ id: 3, email: "", relation: "guardian", status: "invited", source: "invite" },
		]);
	});
});

describe("invitePatientAccess", () => {
	const invite = (db: TestDb, email: string, relation: "self" | "guardian" = "self") =>
		invitePatientAccess(db, { patientId: 1, email, relation, grantedBy: "doc" });

	it("waits as invited while no verified account has the address", async () => {
		const db = linksDb();
		expect(await invite(db, "new@ktb.test", "guardian")).toMatchObject({
			patientId: 1,
			userId: null,
			email: "new@ktb.test",
			relation: "guardian",
			status: "invited",
			source: "invite",
			grantedBy: "doc",
		});
		// An account that has not verified the address gets nothing yet.
		expect(await invite(db, "leo@ktb.test")).toMatchObject({ userId: null, status: "invited" });
		expect(await listPatientProfiles(db, "leo")).toEqual([]);
	});

	it("is active at once for an account with that verified email", async () => {
		const db = linksDb();
		expect(await invite(db, "eva@ktb.test")).toMatchObject({
			userId: "eva",
			email: "eva@ktb.test",
			status: "active",
		});
		expect(await listPatientProfiles(db, "eva")).toEqual([
			{ patientId: 1, name: "Ana", relation: "self" },
		]);
	});

	it("reuses the row when the same address is invited again", async () => {
		const db = linksDb();
		const first = await invite(db, "new@ktb.test", "self");
		const again = await invite(db, "new@ktb.test", "guardian");
		expect(again).toMatchObject({ id: first.id, relation: "guardian", status: "invited" });
		expect((await rowsOf(db, 1)).filter((row) => row.email === "new@ktb.test")).toHaveLength(1);
	});

	it("reuses the link the invited account already holds", async () => {
		const db = linksDb();
		const [pending] = await db
			.insert(patientAccess)
			.values({ patientId: 1, userId: "eva", relation: "self", status: "pending", source: "cpf" })
			.returning();
		expect(await invite(db, "eva@ktb.test", "guardian")).toMatchObject({
			id: pending!.id,
			userId: "eva",
			email: "eva@ktb.test",
			relation: "guardian",
			status: "active",
			source: "invite",
			grantedBy: "doc",
		});
		expect((await rowsOf(db, 1)).filter((row) => row.userId === "eva")).toHaveLength(1);
	});
});

describe("PatientLinksLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<PatientLinks, never>;
	let db: TestDb;

	beforeEach(() => {
		db = linksDb();
		runtime = ManagedRuntime.make(PatientLinksLive.pipe(Layer.provide(Layer.succeed(Db, db))));
	});

	afterEach(() => runtime.dispose());

	const as = <A, E extends { _tag: string }>(
		principal: { userId: string; actorId?: string } | null,
		use: (svc: (typeof PatientLinks)["Service"]) => Effect.Effect<A, E>,
	) =>
		runtime.runPromise(
			Effect.flatMap(PatientLinks, use).pipe(
				Effect.provideService(Principal, principal),
				Effect.catch((e) =>
					Effect.succeed(
						e._tag === "Forbidden"
							? `forbidden:${(e as unknown as { path: string }).path}`
							: `rejected:${(e as unknown as { code: string }).code}`,
					),
				),
			),
		);
	const doc = { userId: "doc" };
	const secretary = { userId: "doc", actorId: "sec" };

	it("lists the links of the doctor's own patient", async () => {
		expect(await as(doc, (s) => s.list(2))).toEqual([
			{ id: 2, email: "Ana@KTB.test", relation: "self", status: "pending", source: "cpf" },
			{ id: 3, email: "ana@ktb.test", relation: "guardian", status: "invited", source: "invite" },
		]);
	});

	it("invites under a normalized address, recording who granted it", async () => {
		expect(
			await as(doc, (s) => s.invite({ patientId: 1, email: "  New@KTB.test ", relation: "self" })),
		).toMatchObject({ patientId: 1, email: "new@ktb.test", status: "invited", grantedBy: "doc" });
		// A secretary acting for the doctor is the one on record.
		expect(
			await as(secretary, (s) =>
				s.invite({ patientId: 1, email: "eva@ktb.test", relation: "guardian" }),
			),
		).toMatchObject({ userId: "eva", relation: "guardian", status: "active", grantedBy: "sec" });
	});

	it("rejects a malformed address or an unknown relation without writing", async () => {
		const before = await rowsOf(db, 1);
		expect(
			await as(doc, (s) => s.invite({ patientId: 1, email: "not-an-email", relation: "self" })),
		).toBe("rejected:invalid_email");
		expect(
			await as(doc, (s) => s.invite({ patientId: 1, email: "new@ktb.test", relation: "friend" })),
		).toBe("rejected:invalid_relation");
		expect(await rowsOf(db, 1)).toEqual(before);
	});

	it("approves only a link still awaiting approval", async () => {
		expect(await as(secretary, (s) => s.approve(2))).toBe(true);
		expect(await rowsOf(db, 2)).toMatchObject([
			{ id: 2, status: "active", grantedBy: "sec" },
			{ id: 3, status: "invited" },
		]);
		// Already active, still only invited, or unknown: nothing to approve.
		expect(await as(doc, (s) => s.approve(2))).toBe(false);
		expect(await as(doc, (s) => s.approve(3))).toBe(false);
		expect(await as(doc, (s) => s.approve(99))).toBe(false);
		expect((await rowsOf(db, 2)).map((row) => row.status)).toEqual(["active", "invited"]);
	});

	it("revokes a link whatever its status, taking it off the list", async () => {
		expect(await as(doc, (s) => s.revoke(3))).toBe(true);
		expect(await rowsOf(db, 2)).toMatchObject([
			{ id: 2, status: "pending" },
			{ id: 3, status: "revoked", grantedBy: "doc" },
		]);
		expect(await as(doc, (s) => Effect.map(s.list(2), (rows) => rows.map((r) => r.id)))).toEqual([
			2,
		]);
		expect(await as(doc, (s) => s.revoke(99))).toBe(false);
	});

	it("never touches another doctor's patient", async () => {
		expect(await as(doc, (s) => s.list(3))).toBe("forbidden:patient-access.read");
		expect(
			await as(doc, (s) => s.invite({ patientId: 3, email: "new@ktb.test", relation: "self" })),
		).toBe("forbidden:patient-access.invite");
		expect(await as(doc, (s) => s.approve(4))).toBe(false);
		expect(await as(doc, (s) => s.revoke(4))).toBe(false);
		expect(await rowsOf(db, 3)).toMatchObject([{ id: 4, status: "invited", grantedBy: "other" }]);
	});

	it("refuses every operation without a principal", async () => {
		expect(await as(null, (s) => s.list(1))).toBe("forbidden:patient-access.read");
		expect(
			await as(null, (s) => s.invite({ patientId: 1, email: "new@ktb.test", relation: "self" })),
		).toBe("forbidden:patient-access.invite");
		expect(await as(null, (s) => s.approve(2))).toBe("forbidden:patient-access.approve");
		expect(await as(null, (s) => s.revoke(2))).toBe("forbidden:patient-access.revoke");
		expect(await rowsOf(db, 2)).toMatchObject([{ status: "pending" }, { status: "invited" }]);
	});
});

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

	it("claims the invites addressed to the account through syncLinks", async () => {
		const db = linksDb();
		const scoped = ManagedRuntime.make(
			PatientProfilesLive.pipe(Layer.provide(Layer.succeed(Db, db))),
		);
		const claimed = await scoped.runPromise(
			Effect.flatMap(PatientProfiles, (directory) => directory.syncLinks("ana")),
		);
		await scoped.dispose();
		expect(claimed).toBe(2);
		expect((await listPatientProfiles(db, "ana")).map((p) => p.patientId)).toEqual([1, 2]);
	});

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

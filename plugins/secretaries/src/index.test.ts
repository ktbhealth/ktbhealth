import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { eq } from "drizzle-orm";

import { DoctorDelegations } from "@ktb/auth";
import { Principal } from "@ktb/authz";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";

import {
	claimDoctorInvites,
	DoctorDelegationsLive,
	inviteSecretary,
	listDelegatedProfiles,
	listDoctorAccess,
	normalizeEmail,
	plugins,
	revokeSecretary,
	Secretaries,
	SecretariesLive,
	secretariesRoutesPlugin,
	secretariesServicesPlugin,
	secretariesTablesPlugin,
} from "./index.ts";
import { doctorAccess } from "./schema.ts";

// doc-a..doc-d and both are doctors. sec holds active access to doc-a and
// doc-b, an invite to doc-c and a revoked link to doc-d; both is a doctor
// who is also doc-a's secretary. newbie has a verified account and
// unverified an unproven one — neither linked to anything yet.
const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0);
INSERT INTO "user" VALUES
  ('doc-a', 'a@ktb.test', 1), ('doc-b', 'b@ktb.test', 1), ('doc-c', 'c@ktb.test', 1),
  ('doc-d', 'd@ktb.test', 1), ('both', 'both@ktb.test', 1), ('sec', 'sec@ktb.test', 1),
  ('newbie', 'newbie@ktb.test', 1), ('unverified', 'unverified@ktb.test', 0), ('plain', 'plain@ktb.test', 1);
CREATE TABLE doctors (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, crm TEXT, specialty TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO doctors (id, user_id, display_name, created_at, updated_at) VALUES
  (1, 'doc-a', 'Zeca Lima', 0, 0),
  (2, 'doc-b', 'Ana Souza', 0, 0),
  (3, 'doc-c', 'Dr. Caio', 0, 0),
  (4, 'doc-d', 'Dra. Dora', 0, 0),
  (5, 'both', 'Dra. Bia', 0, 0);
CREATE TABLE doctor_access (id INTEGER PRIMARY KEY AUTOINCREMENT, doctor_id INTEGER NOT NULL, user_id TEXT, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'secretary', status TEXT NOT NULL DEFAULT 'invited', invited_by TEXT, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX doctor_access_doctor_email_idx ON doctor_access (doctor_id, email);
INSERT INTO doctor_access (doctor_id, user_id, email, status) VALUES
  (1, 'sec', 'sec@ktb.test', 'active'),
  (2, 'sec', 'sec@ktb.test', 'active'),
  (3, NULL, 'sec@ktb.test', 'invited'),
  (4, 'sec', 'sec@ktb.test', 'revoked'),
  (1, 'both', 'both@ktb.test', 'active');
`;

const freshDb = () => makeDb(makeD1(DDL));

describe("listDelegatedProfiles", () => {
	const db = freshDb();

	it("leaves a doctor's own profile to the doctors plugin", async () => {
		expect(await listDelegatedProfiles(db, "doc-a")).toEqual([]);
	});

	it("returns only actively delegated profiles for a secretary, by name", async () => {
		expect(await listDelegatedProfiles(db, "sec")).toEqual([
			{
				doctorId: 2,
				userId: "doc-b",
				email: "b@ktb.test",
				displayName: "Ana Souza",
				role: "secretary",
			},
			{
				doctorId: 1,
				userId: "doc-a",
				email: "a@ktb.test",
				displayName: "Zeca Lima",
				role: "secretary",
			},
		]);
	});

	it("lists what a doctor is secretary of, not their own profile", async () => {
		expect((await listDelegatedProfiles(db, "both")).map((p) => [p.doctorId, p.role])).toEqual([
			[1, "secretary"],
		]);
	});

	it("returns nothing for a user with no delegation", async () => {
		expect(await listDelegatedProfiles(db, "stranger")).toEqual([]);
	});
});

describe("claimDoctorInvites", () => {
	it("activates the invites addressed to a verified email", async () => {
		const db = freshDb();
		expect(await claimDoctorInvites(db, "sec")).toBe(1);
		expect((await listDelegatedProfiles(db, "sec")).map((p) => p.doctorId)).toEqual([2, 3, 1]);
		// Nothing left to claim; the revoked link stays revoked.
		expect(await claimDoctorInvites(db, "sec")).toBe(0);
	});

	it("claims nothing for an unverified email or an unknown user", async () => {
		const db = freshDb();
		await inviteSecretary(db, { doctorId: 1, email: "unverified@ktb.test", invitedBy: "doc-a" });
		expect(await claimDoctorInvites(db, "unverified")).toBe(0);
		expect(await claimDoctorInvites(db, "ghost")).toBe(0);
		expect(await listDelegatedProfiles(db, "unverified")).toEqual([]);
	});
});

describe("secretaries repo", () => {
	it("normalizes emails", () => {
		expect(normalizeEmail("  Sec@KTB.test ")).toBe("sec@ktb.test");
	});

	it("lists a doctor's delegations without revoked rows", async () => {
		const db = freshDb();
		expect((await listDoctorAccess(db, 1)).map((r) => [r.email, r.status])).toEqual([
			["both@ktb.test", "active"],
			["sec@ktb.test", "active"],
		]);
		expect(await listDoctorAccess(db, 4)).toEqual([]);
	});

	it("activates at once for a verified account, waits otherwise", async () => {
		const db = freshDb();
		const known = await inviteSecretary(db, {
			doctorId: 2,
			email: "newbie@ktb.test",
			invitedBy: "doc-b",
		});
		expect(known).toMatchObject({ userId: "newbie", status: "active", invitedBy: "doc-b" });
		const unproven = await inviteSecretary(db, {
			doctorId: 2,
			email: "unverified@ktb.test",
			invitedBy: "doc-b",
		});
		expect(unproven).toMatchObject({ userId: null, status: "invited" });
		const unknown = await inviteSecretary(db, {
			doctorId: 2,
			email: "nobody@ktb.test",
			invitedBy: "doc-b",
		});
		expect(unknown).toMatchObject({ userId: null, status: "invited" });
	});

	it("reuses the row when re-inviting a revoked address", async () => {
		const db = freshDb();
		const again = await inviteSecretary(db, {
			doctorId: 4,
			email: "sec@ktb.test",
			invitedBy: "doc-d",
		});
		expect(again).toMatchObject({ userId: "sec", status: "active" });
		expect(await db.select().from(doctorAccess).where(eq(doctorAccess.doctorId, 4))).toHaveLength(
			1,
		);
	});

	it("revokes only the doctor's own delegations", async () => {
		const db = freshDb();
		const [row] = await listDoctorAccess(db, 2);
		expect(await revokeSecretary(db, 1, row!.id)).toBe(false);
		expect(await revokeSecretary(db, 2, row!.id)).toBe(true);
		expect(await listDoctorAccess(db, 2)).toEqual([]);
	});
});

describe("DoctorDelegationsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<DoctorDelegations, never>;
	const db = freshDb();

	beforeAll(() => {
		runtime = ManagedRuntime.make(DoctorDelegationsLive.pipe(Layer.provide(Layer.succeed(Db, db))));
	});

	afterAll(() => runtime.dispose());

	const directory = <A>(use: (d: (typeof DoctorDelegations)["Service"]) => Effect.Effect<A>) =>
		runtime.runPromise(Effect.flatMap(DoctorDelegations, use));

	it("claims invites, then re-reads links on every call so a revocation applies at once", async () => {
		expect((await directory((d) => d.listFor("sec"))).map((p) => p.doctorId)).toEqual([2, 1]);
		expect(await directory((d) => d.claimInvites("sec"))).toBe(1);
		expect((await directory((d) => d.listFor("sec"))).map((p) => p.doctorId)).toEqual([2, 3, 1]);
		await db.update(doctorAccess).set({ status: "revoked" });
		expect(await directory((d) => d.listFor("sec"))).toEqual([]);
	});
});

describe("SecretariesLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<Secretaries, never>;
	const db = freshDb();

	beforeAll(() => {
		runtime = ManagedRuntime.make(SecretariesLive.pipe(Layer.provide(Layer.succeed(Db, db))));
	});

	afterAll(() => runtime.dispose());

	const as = <A, E extends { _tag: string }>(
		principal: { userId: string; actorId?: string } | null,
		use: (svc: (typeof Secretaries)["Service"]) => Effect.Effect<A, E>,
	) =>
		runtime.runPromise(
			Effect.flatMap(Secretaries, use).pipe(
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

	it("lets a doctor list, invite and revoke their own secretaries", async () => {
		const doc = { userId: "doc-b" };
		expect(await as(doc, (s) => Effect.map(s.list(), (rows) => rows.map((r) => r.email)))).toEqual([
			"sec@ktb.test",
		]);
		const invited = await as(doc, (s) => s.invite("  Newbie@KTB.test "));
		expect(invited).toMatchObject({ doctorId: 2, email: "newbie@ktb.test", status: "active" });
		const id = (invited as { id: number }).id;
		expect(await as(doc, (s) => s.revoke(id))).toBe(true);
		// Another doctor cannot revoke it back or touch it.
		expect(await as({ userId: "doc-a" }, (s) => s.revoke(id))).toBe(false);
	});

	it("rejects malformed addresses and inviting oneself", async () => {
		const doc = { userId: "doc-b" };
		expect(await as(doc, (s) => s.invite("not-an-email"))).toBe("rejected:invalid_email");
		expect(await as(doc, (s) => s.invite("B@ktb.test"))).toBe("rejected:self");
	});

	it("refuses system contexts, delegated callers and non-doctors", async () => {
		expect(await as(null, (s) => s.list())).toBe("forbidden:secretary.read");
		expect(await as({ userId: "doc-a", actorId: "sec" }, (s) => s.invite("x@ktb.test"))).toBe(
			"forbidden:secretary.invite",
		);
		expect(await as({ userId: "plain" }, (s) => s.revoke(1))).toBe("forbidden:secretary.revoke");
	});
});

describe("secretaries plugins", () => {
	it("contributes the doctor_access table and the services", () => {
		expect(plugins).toEqual([
			secretariesTablesPlugin,
			secretariesServicesPlugin,
			secretariesRoutesPlugin,
		]);
		expect(secretariesRoutesPlugin.id).toBe("secretaries.routes");
		expect(secretariesRoutesPlugin.routes).toHaveLength(1);
		expect(secretariesTablesPlugin.id).toBe("secretaries.tables");
		expect(secretariesTablesPlugin.tables.doctorAccess).toBe(doctorAccess);
		expect(secretariesServicesPlugin.id).toBe("secretaries.services");
		expect(secretariesServicesPlugin.services).toBeDefined();
	});
});

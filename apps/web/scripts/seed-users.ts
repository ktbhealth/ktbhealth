// Local dev seed: creates one dev account per profile kind through
// better-auth so passwords are hashed properly. Emails are marked
// verified (no inbox in dev). Profiles are derived from links, so each
// account gets the link that makes it what it is:
//
//   admin@ktb.test     doctor (own profile) — platform admin when listed
//                      in PLATFORM_ADMIN_EMAILS (apps/web/.env.local)
//   user@ktb.test      doctor (own profile) — never platform admin
//   secretary@ktb.test secretary acting for user@ktb.test
//   patient@ktb.test   patient portal, "self" on a record of user@ktb.test
//   guardian@ktb.test  patient portal, "guardian" of a child record of
//                      user@ktb.test
//
// Idempotent — existing emails are skipped, missing links are filled in.
//
//   bun run db:seed                 # uses defaults below
//   SEED_PASSWORD=… bun run db:seed # override the shared password
import { getPlatformProxy } from "wrangler";

import { and, eq } from "drizzle-orm";

import { makeDb, type DbClient } from "@ktb/db";
import { patientAccess, patients, user } from "@ktb/db/schema";
import { makeAuth } from "@ktb/auth-better";
import { ensureDoctorProfile } from "@ktb/doctors";
import { inviteSecretary } from "@ktb/secretaries";
import type { PatientAccessRelation } from "@ktb/patient-access/schema";

const PASSWORD = process.env.SEED_PASSWORD ?? "dev-password-123";
const USERS = [
	{ email: "admin@ktb.test", name: "Admin" },
	{ email: "user@ktb.test", name: "User" },
	{ email: "secretary@ktb.test", name: "Secretary" },
	{ email: "patient@ktb.test", name: "Patient" },
	{ email: "guardian@ktb.test", name: "Guardian" },
] as const;
type SeedEmail = (typeof USERS)[number]["email"];

/** The patient record `name` owned by `ownerId`, created on first call. */
const ensurePatient = async (
	db: DbClient,
	ownerId: string,
	fields: { readonly name: string; readonly email: string | null; readonly birthDate: string },
): Promise<number> => {
	const [existing] = await db
		.select({ id: patients.id })
		.from(patients)
		.where(and(eq(patients.ownerId, ownerId), eq(patients.name, fields.name)));
	if (existing) return existing.id;
	const [row] = await db
		.insert(patients)
		.values({ ownerId, ...fields, createdAt: new Date() })
		.returning({ id: patients.id });
	return row!.id;
};

const grantPatientAccess = (
	db: DbClient,
	input: {
		readonly patientId: number;
		readonly userId: string;
		readonly relation: PatientAccessRelation;
		readonly grantedBy: string;
	},
) =>
	db
		.insert(patientAccess)
		.values({ ...input, status: "active", source: "invite" })
		.onConflictDoNothing();

const { env, dispose } = await getPlatformProxy({
	configPath: "wrangler.jsonc",
	remoteBindings: false,
});
try {
	const db = makeDb(env.DB as D1Database);
	const auth = makeAuth(db, {
		secret: (env as Record<string, unknown>).BETTER_AUTH_SECRET as string | undefined,
		baseURL: (env as Record<string, unknown>).BETTER_AUTH_URL as string | undefined,
	});
	const ids = {} as Record<SeedEmail, string>;
	for (const u of USERS) {
		try {
			await auth.api.signUpEmail({ body: { ...u, password: PASSWORD } });
			console.log(`[seed] created ${u.email}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (/already exists|already taken|duplicate/i.test(msg)) {
				console.log(`[seed] ${u.email} already exists — skipped`);
			} else {
				throw e;
			}
		}
		const [account] = await db
			.update(user)
			.set({ emailVerified: true })
			.where(eq(user.email, u.email))
			.returning({ id: user.id });
		ids[u.email] = account!.id;
	}

	await ensureDoctorProfile(db, ids["admin@ktb.test"], "Admin");
	const doctorId = ids["user@ktb.test"];
	const doctor = await ensureDoctorProfile(db, doctorId, "User");

	await inviteSecretary(db, {
		doctorId: doctor.id,
		email: "secretary@ktb.test",
		invitedBy: doctorId,
	});

	const patientRecord = await ensurePatient(db, doctorId, {
		name: "Patient",
		email: "patient@ktb.test",
		birthDate: "1990-01-01",
	});
	await grantPatientAccess(db, {
		patientId: patientRecord,
		userId: ids["patient@ktb.test"],
		relation: "self",
		grantedBy: doctorId,
	});
	const childRecord = await ensurePatient(db, doctorId, {
		name: "Child of Guardian",
		email: null,
		birthDate: "2018-01-01",
	});
	await grantPatientAccess(db, {
		patientId: childRecord,
		userId: ids["guardian@ktb.test"],
		relation: "guardian",
		grantedBy: doctorId,
	});

	console.log(`[seed] password for all: ${PASSWORD}`);
} finally {
	await dispose();
}

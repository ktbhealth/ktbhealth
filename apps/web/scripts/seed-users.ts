// Local dev seed: creates one dev account per profile kind through
// better-auth so passwords are hashed properly. Emails are marked
// verified (no inbox in dev). Profiles are derived from links, so each
// account gets the link that makes it what it is:
//
//   admin@ktb.test     doctor (own profile) — platform admin when listed
//                      in PLATFORM_ADMIN_EMAILS (apps/web/.env.local)
//   user@ktb.test      doctor (own profile) — never platform admin
//   secretary@ktb.test secretary acting for user@ktb.test
//
// Idempotent — existing emails are skipped, missing links are filled in.
//
//   bun run db:seed                 # uses defaults below
//   SEED_PASSWORD=… bun run db:seed # override the shared password
import { getPlatformProxy } from "wrangler";

import { eq } from "drizzle-orm";

import { makeDb } from "@ktb/db";
import { user } from "@ktb/db/schema";
import { makeAuth } from "@ktb/auth-better";
import { ensureDoctorProfile } from "@ktb/doctors";
import { inviteSecretary } from "@ktb/secretaries";

const PASSWORD = process.env.SEED_PASSWORD ?? "dev-password-123";
const USERS = [
	{ email: "admin@ktb.test", name: "Admin" },
	{ email: "user@ktb.test", name: "User" },
	{ email: "secretary@ktb.test", name: "Secretary" },
] as const;
type SeedEmail = (typeof USERS)[number]["email"];

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

	console.log(`[seed] password for all: ${PASSWORD}`);
} finally {
	await dispose();
}

// Local dev seed: creates the generic dev users through better-auth so
// passwords are hashed properly. Idempotent — existing emails are skipped.
//
//   bun run db:seed                 # uses defaults below
//   SEED_PASSWORD=… bun run db:seed # override the shared password
//
// admin@ktb.test reaches /platform only if listed in
// PLATFORM_ADMIN_EMAILS (apps/web/.env.local); user@ktb.test never does.
import { getPlatformProxy } from "wrangler";

import { makeDb } from "@ktb/db";
import { makeAuth } from "@ktb/auth-better";

const PASSWORD = process.env.SEED_PASSWORD ?? "dev-password-123";
const USERS = [
	{ email: "admin@ktb.test", name: "Admin" },
	{ email: "user@ktb.test", name: "User" },
] as const;

const { env, dispose } = await getPlatformProxy({
	configPath: "wrangler.jsonc",
	remoteBindings: false,
});
try {
	const auth = makeAuth(makeDb(env.DB as D1Database), {
		secret: (env as Record<string, unknown>).BETTER_AUTH_SECRET as string | undefined,
		baseURL: (env as Record<string, unknown>).BETTER_AUTH_URL as string | undefined,
	});
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
	}
	console.log(`[seed] password for both: ${PASSWORD}`);
} finally {
	await dispose();
}

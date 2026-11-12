import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { drizzle } from "drizzle-orm/d1";

/** What the host needs to compose and deliver a verification email. */
export interface VerificationEmailInput {
	readonly email: string;
	readonly name: string | null;
	/** Link that verifies the address when opened. */
	readonly url: string;
}

export interface AuthOptions {
	readonly secret?: string;
	readonly baseURL?: string;
	/**
	 * Delivers the verification link. When absent (no email sender
	 * configured) nothing is sent on sign-up. Verification is never
	 * required to sign in — flows that depend on a proven address check
	 * `user.emailVerified` themselves.
	 */
	readonly sendVerificationEmail?: (input: VerificationEmailInput) => Promise<void>;
}

export const makeAuth = (db: ReturnType<typeof drizzle>, opts: AuthOptions = {}) =>
	betterAuth({
		database: drizzleAdapter(db, { provider: "sqlite" }),
		emailAndPassword: { enabled: true },
		emailVerification: {
			sendOnSignUp: opts.sendVerificationEmail !== undefined,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				await opts.sendVerificationEmail?.({ email: user.email, name: user.name ?? null, url });
			},
		},
		// Mirrors the `cpf` column in @ktb/auth/schema, used for the CPF
		// match against patient records. Never accepted from client input:
		// the patient portal sets it through a validating server fn.
		user: { additionalFields: { cpf: { type: "string", required: false, input: false } } },
		secret: opts.secret,
		baseURL: opts.baseURL,
	});

export type Auth = ReturnType<typeof makeAuth>;

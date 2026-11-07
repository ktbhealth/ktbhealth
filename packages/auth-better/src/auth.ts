import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { drizzle } from "drizzle-orm/d1";

export interface AuthOptions {
	readonly secret?: string;
	readonly baseURL?: string;
}

export const makeAuth = (db: ReturnType<typeof drizzle>, opts: AuthOptions = {}) =>
	betterAuth({
		database: drizzleAdapter(db, { provider: "sqlite" }),
		emailAndPassword: { enabled: true },
		secret: opts.secret,
		baseURL: opts.baseURL,
	});

export type Auth = ReturnType<typeof makeAuth>;

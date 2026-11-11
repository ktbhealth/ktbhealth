import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import type { AuthShape, Session, SessionUser } from "@ktb/auth";
import { session as sessionTable, user as userTable } from "@ktb/auth/schema";

export interface AuthOptions {
	readonly secret?: string;
	readonly baseURL?: string;
}

export type AuthDb = ReturnType<typeof drizzle>;

export const makeAuth = (db: AuthDb, opts: AuthOptions = {}) =>
	betterAuth({
		database: drizzleAdapter(db, { provider: "sqlite" }),
		emailAndPassword: { enabled: true },
		secret: opts.secret,
		baseURL: opts.baseURL,
	});

export type Auth = ReturnType<typeof makeAuth>;

export const toSessionUser = (u: {
	id: string;
	email: string;
	name?: string | null;
}): SessionUser => ({
	id: u.id,
	email: u.email,
	name: u.name ?? null,
});

export const toSession = (s: {
	user: { id: string; email: string; name?: string | null };
	session: { id: string; expiresAt: Date };
}): Session => ({
	user: toSessionUser(s.user),
	sessionId: s.session.id,
	expiresAt: s.session.expiresAt,
});

/**
 * Auth port implementation over a better-auth instance + its drizzle
 * database (T-034). The `user.banned` flag is enforced here — not in
 * better-auth — so `getSession` returns null for suspended users and
 * `setUserBanned` revokes their session rows on ban.
 */
export const makeAuthService = (auth: Auth, db: AuthDb): AuthShape => ({
	getSession: async (headers) => {
		const s = await auth.api.getSession({ headers });
		if (!s) return null;
		const rows = await db
			.select({ banned: userTable.banned })
			.from(userTable)
			.where(eq(userTable.id, s.user.id))
			.limit(1);
		// A live session always resolves to a user row (FK cascade), so
		// `some` is equivalent to checking rows[0] without an
		// uncoverable optional-chain branch.
		if (rows.some((r) => r.banned === true)) return null;
		return toSession(s);
	},
	setUserBanned: async (userId, banned) => {
		await db.update(userTable).set({ banned }).where(eq(userTable.id, userId));
		if (banned) {
			// Revoke every live session — getSession already returns null
			// for banned users, but deleting the rows also kills sessions
			// better-auth would otherwise keep refreshing.
			await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
		}
	},
});

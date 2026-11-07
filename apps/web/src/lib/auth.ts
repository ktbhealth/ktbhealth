import { getCookie, setCookie } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";

import { db } from "#/lib/platform.ts";
import { users } from "@ktb/db/schema";

const COOKIE = "an_uid";

export type SessionUser = typeof users.$inferSelect;

export async function getSessionUser(): Promise<SessionUser | null> {
	const raw = getCookie(COOKIE);
	const id = raw ? Number.parseInt(raw, 10) : Number.NaN;
	if (!Number.isFinite(id)) return null;
	const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
	return rows[0] ?? null;
}

export async function ensureSessionUser(): Promise<SessionUser> {
	const existing = await getSessionUser();
	if (existing) return existing;
	const handle = `guest-${Math.random().toString(36).slice(2, 8)}`;
	const inserted = await db
		.insert(users)
		.values({ handle, isGuest: true, createdAt: new Date() })
		.returning();
	const user = inserted[0] as SessionUser;
	setCookie(COOKIE, String(user.id), {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
	});
	return user;
}

/** Upgrade the guest session to a named user (minimal "sign in"). */
export async function signIn(name: string): Promise<SessionUser> {
	const user = await ensureSessionUser();
	await db
		.update(users)
		.set({
			name,
			handle: name.toLowerCase().replace(/\s+/g, "-"),
			isGuest: false,
		})
		.where(eq(users.id, user.id));
	return { ...user, name, isGuest: false };
}

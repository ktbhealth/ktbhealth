import type { Session, SessionUser } from "@ktb/auth";

export { makeAuth } from "./auth.ts";
export type { Auth, AuthOptions, VerificationEmailInput } from "./auth.ts";

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

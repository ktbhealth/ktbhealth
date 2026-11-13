import { describe, expect, it } from "vitest";

import { makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { makeAuth, toSession, toSessionUser } from "./index.ts";

describe("toSessionUser", () => {
	it("converts user record to SessionUser shape", () => {
		const u = toSessionUser({ id: "u-1", email: "dr@example.com", name: "Dra. Ana" });
		expect(u).toEqual({ id: "u-1", email: "dr@example.com", name: "Dra. Ana" });
	});

	it("normalizes null or undefined name to null", () => {
		const u = toSessionUser({ id: "u-2", email: "x@example.com" });
		expect(u.name).toBeNull();
	});
});

describe("toSession", () => {
	it("converts better-auth session output to Session port shape", () => {
		const exp = new Date(Date.now() + 3600_000);
		const s = toSession({
			user: { id: "u-1", email: "dr@example.com", name: "Dra. Ana" },
			session: { id: "sess-1", expiresAt: exp },
		});
		expect(s).toEqual({
			user: { id: "u-1", email: "dr@example.com", name: "Dra. Ana" },
			sessionId: "sess-1",
			expiresAt: exp,
		});
	});
});

describe("makeAuth", () => {
	it("constructs a betterAuth instance with drizzle adapter and options", () => {
		const db = makeDb(makeD1());
		const auth = makeAuth(db, {
			secret: "test-secret-at-least-32-characters-long",
			baseURL: "http://localhost:3000",
		});
		expect(auth).toBeDefined();
		expect(typeof auth.handler).toBe("function");
		expect(auth.api).toBeDefined();
	});

	it("sends no verification email when the host supplies no sender", async () => {
		const auth = makeAuth(makeDb(makeD1()));
		const { emailVerification } = auth.options;
		expect(emailVerification.sendOnSignUp).toBe(false);
		await expect(
			emailVerification.sendVerificationEmail({
				user: { id: "u1", email: "a@ktb.test", name: "Ana" } as never,
				url: "http://localhost:3000/verify",
				token: "t",
			}),
		).resolves.toBeUndefined();
	});

	it("delegates verification emails to the host sender on sign-up", async () => {
		const sent: unknown[] = [];
		const auth = makeAuth(makeDb(makeD1()), {
			sendVerificationEmail: async (input) => {
				sent.push(input);
			},
		});
		const { emailVerification } = auth.options;
		expect(emailVerification.sendOnSignUp).toBe(true);
		const url = "http://localhost:3000/verify";
		await emailVerification.sendVerificationEmail({
			user: { id: "u1", email: "a@ktb.test", name: "Ana" } as never,
			url,
			token: "t",
		});
		await emailVerification.sendVerificationEmail({
			user: { id: "u2", email: "b@ktb.test" } as never,
			url,
			token: "t",
		});
		expect(sent).toEqual([
			{ email: "a@ktb.test", name: "Ana", url },
			{ email: "b@ktb.test", name: null, url },
		]);
	});
});

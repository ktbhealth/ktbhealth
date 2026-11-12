import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";

import { Auth, type AuthShape, type Session } from "@ktb/auth";

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => requestHeaders.current,
}));

import { resetServerRuntime, setServerRuntime, type ServerRuntime } from "./runtime.ts";
import {
	ensureSessionUser,
	getSessionUser,
	getTenantSelector,
	UnauthenticatedError,
} from "./session.ts";

const session: Session = {
	user: { id: "u1", email: "a@x.com", name: "A" },
	sessionId: "s1",
	expiresAt: new Date("2030-01-01T00:00:00Z"),
};

let sessionResult: Session | null = session;

const authShape: AuthShape = {
	getSession: async () => sessionResult,
	setUserBanned: async () => {},
};

const runtime: ServerRuntime = {
	run: <A, E>(effect: Effect.Effect<A, E, unknown>) =>
		Effect.runPromise(
			effect.pipe(Effect.provideService(Auth, authShape)) as Effect.Effect<A, E, never>,
		),
	runAs: <A, E>(_user: { readonly id: string }, effect: Effect.Effect<A, E, unknown>) =>
		Effect.runPromise(effect as Effect.Effect<A, E, never>),
	getLocale: () => "en",
	audioTranscribeModel: "test-model",
};

beforeEach(() => {
	resetServerRuntime();
	setServerRuntime(runtime);
	sessionResult = session;
	requestHeaders.current = new Headers();
});

describe("getSessionUser", () => {
	it("returns the session user for explicit headers", async () => {
		const headers = new Headers({ cookie: "session=abc" });
		await expect(getSessionUser(headers)).resolves.toEqual(session.user);
	});

	it("falls back to the request headers when none are passed", async () => {
		requestHeaders.current = new Headers({ "x-test": "1" });
		await expect(getSessionUser()).resolves.toEqual(session.user);
	});

	it("returns null when there is no session", async () => {
		sessionResult = null;
		await expect(getSessionUser(new Headers())).resolves.toBeNull();
	});
});

describe("ensureSessionUser", () => {
	it("returns the user when a session exists", async () => {
		await expect(ensureSessionUser(new Headers())).resolves.toEqual(session.user);
	});

	it("throws a 401 UnauthenticatedError without a session", async () => {
		sessionResult = null;
		const error = await ensureSessionUser(new Headers()).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(UnauthenticatedError);
		expect((error as UnauthenticatedError).status).toBe(401);
		expect((error as Error).message).toBe("unauthenticated");
	});
});

describe("getTenantSelector", () => {
	it("reads the tenant selector from explicit headers", async () => {
		const headers = new Headers({ "x-tenant-id": "42", "x-tenant-slug": "clinic-a" });
		await expect(getTenantSelector(headers)).resolves.toEqual({
			id: 42,
			slug: "clinic-a",
		});
	});

	it("falls back to the request headers and returns null without tenant headers", async () => {
		requestHeaders.current = new Headers({ "x-tenant": '{"slug":"raw"}' });
		await expect(getTenantSelector()).resolves.toEqual({ raw: '{"slug":"raw"}' });
		requestHeaders.current = new Headers();
		await expect(getTenantSelector()).resolves.toBeNull();
	});
});

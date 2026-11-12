import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));

import { Auth } from "@ktb/auth";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { Principal } from "@ktb/authz";
import { resetServerRuntime, setServerRuntime } from "@ktb/server-fns";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { usersServicesPlugin } from "./index.ts";
import { setUserSuspendedFn } from "./fns.ts";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" (id, name, email, email_verified, image, banned, created_at, updated_at) VALUES
  ('u1', 'Admin', 'admin@x.com', 1, NULL, 0, 1000, 1000),
  ('u2', 'Doc', 'doc@x.com', 0, NULL, 0, 2000, 2000);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, status TEXT);
`;

const sessionFor = (email: string | null) =>
	email === null
		? null
		: {
				user: { id: `id-${email}`, email, name: email },
				sessionId: "s1",
				expiresAt: new Date(Date.now() + 3600_000),
			};

describe("users admin fns", () => {
	let runtime: ManagedRuntime.ManagedRuntime<unknown, never>;
	let currentEmail: string | null = null;
	const setUserBanned = vi.fn(async (_userId: string, _banned: boolean) => {});
	const authShape = {
		getSession: async () => sessionFor(currentEmail) as never,
		setUserBanned,
	};

	beforeAll(async () => {
		const db = makeDb(makeD1(DDL));
		const env = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(Auth, authShape),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		const services = usersServicesPlugin.services as Layer.Layer<unknown, unknown, unknown>;
		runtime = ManagedRuntime.make(
			services.pipe(Layer.provide(env)) as unknown as Layer.Layer<unknown, never, never>,
		);
		setServerRuntime({
			run: (effect) =>
				runtime.runPromise(effect.pipe(Effect.provideService(Auth, authShape)) as never),
			runAs: (user, effect) =>
				runtime.runPromise(
					effect.pipe(
						Effect.provideService(Principal, {
							userId: user.id,
							email: user.email,
						}),
					),
				),
			audioTranscribeModel: "test-model",
			getLocale: () => "en",
		});
	});

	afterAll(() => {
		resetServerRuntime();
		return runtime.dispose();
	});

	it("rejects anonymous callers", async () => {
		currentEmail = null;
		await expect(setUserSuspendedFn({ data: { userId: "u2", suspended: true } })).rejects.toThrow(
			"unauthenticated",
		);
	});

	it("denies non-admin principals", async () => {
		currentEmail = "user@x.com";
		setUserBanned.mockClear();
		expect(await setUserSuspendedFn({ data: { userId: "u2", suspended: true } })).toEqual({
			ok: false,
		});
		expect(setUserBanned).not.toHaveBeenCalled();
	});

	it("suspends and reactivates a user for platform admins", async () => {
		currentEmail = "admin@x.com";
		setUserBanned.mockClear();
		expect(await setUserSuspendedFn({ data: { userId: "u2", suspended: true } })).toEqual({
			ok: true,
			data: null,
		});
		expect(setUserBanned).toHaveBeenCalledWith("u2", true);
		expect(await setUserSuspendedFn({ data: { userId: "u2", suspended: false } })).toEqual({
			ok: true,
			data: null,
		});
		expect(setUserBanned).toHaveBeenCalledWith("u2", false);
	});
});

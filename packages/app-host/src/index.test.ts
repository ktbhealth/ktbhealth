import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { CommandBus, QueryBus } from "@effect-server-utils/cqrs";
import { Auth } from "@ktb/auth";
import { makeD1 } from "@ktb/db/testing";
import {
	NotificationsMarkAllRead,
	NotificationsUnreadCount,
} from "../../../plugins/notifications/src/api.ts";
import * as Effect from "effect/Effect";

import { createApp, plugins } from "./index.ts";

const DDL = `
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, payload TEXT, read_at INTEGER, created_at INTEGER NOT NULL);
`;

const app = createApp({
	DB: makeD1(DDL),
	BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!!",
	BETTER_AUTH_URL: "http://localhost:3000",
	PLATFORM_ADMIN_EMAILS: "admin@x.com",
	AI: { run: async () => ({ response: "  Texto corrigido.  " }) },
});

/** Structured log lines emitted through Logger.consoleJson. */
const logged = (spy: ReturnType<typeof vi.spyOn>) =>
	spy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes("cqrs"));

afterAll(() => app.runtime.dispose());

afterEach(() => vi.restoreAllMocks());

describe("createApp", () => {
	it("discovers plugins in dependency order", () => {
		expect(app.plugins).toBe(plugins);
		expect(plugins.length).toBeGreaterThan(0);
	});

	it("run executes system-path effects without a principal", async () => {
		await expect(app.run(Effect.succeed("ok"))).resolves.toBe("ok");
	});

	it("the Auth port resolves anonymous headers to no session", async () => {
		const session = await app.run(
			Effect.flatMap(Auth, (auth) => Effect.promise(() => auth.getSession(new Headers()))),
		);
		expect(session).toBeNull();
	});

	describe("CQRS bus middleware", () => {
		let log: ReturnType<typeof vi.spyOn>;

		const user = { id: "u1", email: "u1@x.com" };

		it("passes queries through at debug level", async () => {
			log = vi.spyOn(console, "log").mockImplementation(() => {});
			const count = await app.runAs(
				user,
				Effect.flatMap(QueryBus, (bus) => bus.execute(NotificationsUnreadCount, { userId: "u1" })),
			);
			expect(count).toBe(0);
			// Debug sits below the default Info log level: the query goes through the
			// middleware but emits neither a command log nor a failure warning.
			expect(logged(log)).toEqual([]);
		});

		it("logs successful commands at info", async () => {
			log = vi.spyOn(console, "log").mockImplementation(() => {});
			await app.runAs(
				user,
				Effect.flatMap(CommandBus, (bus) =>
					bus.execute(NotificationsMarkAllRead, { userId: "u1" }),
				),
			);
			expect(logged(log).some((l: string) => l.includes("cqrs command"))).toBe(true);
		});

		it("logs failed dispatches at warning and keeps the typed error", async () => {
			log = vi.spyOn(console, "log").mockImplementation(() => {});
			const exit = await app.runAs(
				user,
				Effect.flatMap(CommandBus, (bus) =>
					// u1 is bound, but the command targets another user's notifications.
					bus.execute(NotificationsMarkAllRead, { userId: "someone-else" }),
				).pipe(Effect.flip),
			);
			expect(exit).toMatchObject({ _tag: "Forbidden" });
			expect(logged(log).some((l: string) => l.includes("cqrs dispatch failed"))).toBe(true);
		});
	});

	describe("correctTranscript", () => {
		it("returns null for an empty transcript without calling the provider", async () => {
			await expect(app.correctTranscript("   ")).resolves.toBeNull();
		});

		it("corrects through the configured Workers AI binding", async () => {
			await expect(app.correctTranscript("texto cru")).resolves.toMatchObject({
				corrected: "Texto corrigido.",
				engine: expect.stringContaining("workers-ai"),
			});
		});
	});
});

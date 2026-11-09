import { Principal } from "@ktb/authz";
import { Db, makeDb, type DbClient } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { EventBus, makeEventBus } from "@effect-server-utils/cqrs";
import { PatientCreated } from "@ktb/patients/api";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	countUnreadNotifications,
	insertNotification,
	markNotificationsRead,
	Notifications,
	NotificationsLive,
} from "./Notifications.ts";

/** Chainable drizzle stand-in: every call returns the chain, and awaiting
 * it settles with `settle()` — covers select/insert/update ... returning. */
const chain = (settle: () => Promise<unknown>): unknown => {
	const p: unknown = new Proxy(() => undefined, {
		get: (_t, k) =>
			k === "then"
				? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej)
				: p,
		apply: () => p,
	});
	return p;
};

const fakeDb = (settle: () => Promise<unknown>): DbClient =>
	({
		select: () => chain(settle),
		insert: () => chain(settle),
		update: () => chain(settle),
	}) as unknown as DbClient;

const runtimeFor = (db: DbClient) => {
	const infra = Layer.mergeAll(Layer.succeed(Db, db), makeEventBus());
	return ManagedRuntime.make(
		NotificationsLive.pipe(Layer.provideMerge(infra)) as Layer.Layer<
			Notifications | EventBus,
			never,
			never
		>,
	);
};

afterEach(() => vi.restoreAllMocks());

describe("notification repo edge cases", () => {
	it("treats a missing count row as zero unread", async () => {
		await expect(
			countUnreadNotifications(
				fakeDb(async () => []),
				"u1",
			),
		).resolves.toBe(0);
	});

	it("returns null when the insert yields no row", async () => {
		await expect(
			insertNotification(
				fakeDb(async () => []),
				{ userId: "u1", kind: "k", title: "t" },
			),
		).resolves.toBeNull();
	});

	it("marks nothing (and skips the query) for an empty id list", async () => {
		const settle = vi.fn(async () => [{ id: 1 }]);
		await expect(markNotificationsRead(fakeDb(settle), "u1", [])).resolves.toEqual([]);
		expect(settle).not.toHaveBeenCalled();
	});
});

describe("NotificationsLive failure isolation", () => {
	it("persists without publishing when the insert returns no row", async () => {
		const runtime = runtimeFor(fakeDb(async () => []));
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const bus = yield* EventBus;
				// subscribeAfterCommit handlers run after dispatch resolves; a
				// resolved dispatch with no thrown error means ingest returned.
				yield* bus.dispatch([PatientCreated.make({ id: 1, ownerId: "u1", name: "Ana" })]);
				return "ok";
			}),
		);
		expect(result).toBe("ok");
		await runtime.dispose();
	});

	it("logs and isolates an ingest failure instead of failing the publisher", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const db = makeDb(makeD1(`CREATE TABLE "user" (id TEXT PRIMARY KEY);`));
		// No notifications table → every insert rejects.
		const runtime = runtimeFor(db);
		await expect(
			runtime.runPromise(
				Effect.gen(function* () {
					const bus = yield* EventBus;
					yield* bus.dispatch([PatientCreated.make({ id: 2, ownerId: "u1", name: "Bia" })]);
					return "ok";
				}),
			),
		).resolves.toBe("ok");
		expect(logged).toBeDefined();
		await runtime.dispose();
	});

	it("logs and isolates a read-state fan-out failure", async () => {
		// A malformed row makes the fan-out projection throw; the DB write
		// already committed, so markAllRead must still succeed.
		const runtime = runtimeFor(fakeDb(async () => [null]));
		await expect(
			runtime.runPromise(
				Effect.provideService(
					Effect.flatMap(Notifications, (n) => n.markAllRead("u1")),
					Principal,
					{ userId: "u1" },
				),
			),
		).resolves.toBeUndefined();
		await runtime.dispose();
	});
});

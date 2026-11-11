import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Command, EventBus, makeEventBus, Query } from "@effect-server-utils/cqrs";
import { Principal } from "@ktb/authz";
import { ConsultationCreated } from "@ktb/consultations/api";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { PatientCreated, PatientDeleted } from "@ktb/patients/api";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";

import {
	countUnreadNotifications,
	insertNotification,
	listNotifications,
	markAllNotificationsRead,
	markNotificationsRead,
	Notifications,
	NotificationsCommands,
	NotificationsCommandsLive,
	NotificationsLive,
	NotificationsQueries,
	NotificationsQueriesLive,
	notificationsHeaderPlugin,
	notificationsServicesPlugin,
	notificationsTablesPlugin,
	plugins,
} from "./index.ts";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u1', 'Dra', 'd@x.com', 0, NULL, 0, 0);
INSERT INTO "user" VALUES ('u2', 'Dr B', 'b@x.com', 0, NULL, 0, 0);
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES "user"(id), kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, payload TEXT, read_at INTEGER, created_at INTEGER NOT NULL);
`;

describe("notifications repo", () => {
	let db: ReturnType<typeof makeDb>;

	beforeAll(() => {
		db = makeDb(makeD1(DDL));
	});

	it("inserts and lists scoped by user, newest first", async () => {
		await insertNotification(db, { userId: "u1", kind: "patient.created", title: "One" });
		await insertNotification(db, {
			userId: "u1",
			kind: "patient.deleted",
			title: "Two",
			body: "Ana",
		});
		await insertNotification(db, { userId: "u2", kind: "x", title: "Other" });
		const rows = await listNotifications(db, "u1");
		expect(rows.map((r) => r.title)).toEqual(["Two", "One"]);
		expect(rows[0]?.body).toBe("Ana");
		expect(rows[0]?.readAt).toBeNull();
		expect(await listNotifications(db, "u2")).toHaveLength(1);
	});

	it("applies the limit when given", async () => {
		const rows = await listNotifications(db, "u1", 1);
		expect(rows).toHaveLength(1);
	});

	it("counts unread and marks read per user", async () => {
		expect(await countUnreadNotifications(db, "u1")).toBe(2);
		const [first] = await listNotifications(db, "u1");
		await markNotificationsRead(db, "u1", [first!.id]);
		expect(await countUnreadNotifications(db, "u1")).toBe(1);
		// Ids of another user are ignored.
		await markNotificationsRead(db, "u1", [9999]);
		await markAllNotificationsRead(db, "u1");
		expect(await countUnreadNotifications(db, "u1")).toBe(0);
	});
});

type AppServices =
	| Notifications
	| EventBus
	| Query.Registered<typeof NotificationsQueries>
	| Command.Registered<typeof NotificationsCommands>;

describe("NotificationsLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<AppServices, never>;

	beforeAll(() => {
		const db = makeDb(makeD1(DDL));
		// Shared infra object → layer memoization → one EventBus instance
		// for the service subscriptions and the test's dispatches.
		const infra = Layer.mergeAll(Layer.succeed(Db, db), makeEventBus());
		// Commands delegate to the Notifications service — mirror the
		// plugin's provideMerge composition so they share the one PubSub.
		const services = Layer.mergeAll(NotificationsQueriesLive, NotificationsCommandsLive).pipe(
			Layer.provideMerge(NotificationsLive),
			Layer.provideMerge(infra),
		);
		runtime = ManagedRuntime.make(
			services as Layer.Layer<AppServices, never, never>,
		) as ManagedRuntime.ManagedRuntime<AppServices, never>;
	});

	afterAll(() => runtime.dispose());

	const asUser = <A, E>(userId: string | null, effect: Effect.Effect<A, E, Notifications>) =>
		runtime.runPromise(
			Effect.provideService(effect, Principal, userId === null ? null : { userId }),
		);

	const call = <A, E>(f: (p: Notifications["Service"]) => Effect.Effect<A, E>) =>
		Effect.flatMap(Notifications, f);

	it("ingests PatientCreated after commit and lists it", async () => {
		await runtime.runPromise(
			Effect.gen(function* () {
				const bus = yield* EventBus;
				yield* bus.dispatch([PatientCreated.make({ id: 1, ownerId: "u1", name: "Ana" })]);
			}),
		);
		const rows = await asUser(
			"u1",
			call((n) => n.list("u1")),
		);
		const hit = rows.find((r) => r.kind === "patient.created");
		expect(hit).toMatchObject({ userId: "u1", title: "Patient created", body: "Ana" });
	});

	it("ingests PatientDeleted and ConsultationCreated", async () => {
		await runtime.runPromise(
			Effect.gen(function* () {
				const bus = yield* EventBus;
				yield* bus.dispatch([
					PatientDeleted.make({ id: 2, ownerId: "u1" }),
					ConsultationCreated.make({ id: 3, userId: "u1", source: "browser" }),
				]);
			}),
		);
		const rows = await asUser(
			"u1",
			call((n) => n.list("u1")),
		);
		expect(rows.map((r) => r.kind)).toEqual(
			expect.arrayContaining(["patient.deleted", "consultation.created"]),
		);
	});

	it("unreadCount and markRead/markAllRead round-trip", async () => {
		const before = await asUser(
			"u1",
			call((n) => n.unreadCount("u1")),
		);
		expect(before).toBeGreaterThan(0);
		const rows = await asUser(
			"u1",
			call((n) => n.list("u1")),
		);
		const unread = rows.filter((r) => r.readAt === null);
		await asUser(
			"u1",
			call((n) =>
				n.markRead(
					"u1",
					unread.slice(0, 1).map((r) => r.id),
				),
			),
		);
		expect(
			await asUser(
				"u1",
				call((n) => n.unreadCount("u1")),
			),
		).toBe(before - 1);
		await asUser(
			"u1",
			call((n) => n.markAllRead("u1")),
		);
		expect(
			await asUser(
				"u1",
				call((n) => n.unreadCount("u1")),
			),
		).toBe(0);
	});

	it("stream replays the persisted backlog for the principal", async () => {
		const head = await asUser(
			"u1",
			Effect.gen(function* () {
				const n = yield* Notifications;
				return yield* Stream.runHead(Stream.take(1)(n.stream("u1")));
			}),
		);
		expect(head._tag).toBe("Some");
	});

	it("live fan-out reaches only the owning user's stream", async () => {
		// u2 has no persisted rows in this db → its stream waits on the
		// pubsub; the u1 event must be filtered out.
		const result = await runtime.runPromise(
			Effect.provideService(
				Effect.gen(function* () {
					const n = yield* Notifications;
					const bus = yield* EventBus;
					const fiber = yield* Stream.runCollect(Stream.take(1)(n.stream("u2"))).pipe(
						Effect.forkChild,
					);
					// Let the stream subscribe to the pubsub before publishing.
					yield* Effect.sleep("50 millis");
					yield* bus.dispatch([
						PatientCreated.make({ id: 10, ownerId: "u1", name: "Not Yours" }),
						PatientCreated.make({ id: 11, ownerId: "u2", name: "Live" }),
					]);
					return yield* Fiber.join(fiber);
				}),
				Principal,
				{ userId: "u2" },
			),
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ title: "Patient created", description: "Live" });
	});

	it("fails Forbidden for another userId and for null principal", async () => {
		await expect(
			asUser(
				"u2",
				call((n) => n.list("u1")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				null,
				call((n) => n.unreadCount("u1")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
		await expect(
			asUser(
				"u1",
				call((n) => n.markAllRead("u2")),
			),
		).rejects.toMatchObject({ _tag: "Forbidden" });
	});

	it("CQRS queries and commands dispatch with principal authz", async () => {
		const out = await runtime.runPromise(
			Effect.provideService(
				Effect.gen(function* () {
					const bus = yield* EventBus;
					yield* bus.dispatch([PatientCreated.make({ id: 12, ownerId: "u1", name: "Counted" })]);
					const queries = yield* Query.dispatcher(NotificationsQueries);
					const commands = yield* Command.dispatcher(NotificationsCommands);
					const count = yield* queries["notifications.unreadCount"]({ userId: "u1" });
					yield* commands["notifications.markAllRead"]({ userId: "u1" });
					const after = yield* queries["notifications.unreadCount"]({ userId: "u1" });
					return { count, after };
				}).pipe(Effect.scoped),
				Principal,
				{ userId: "u1" },
			),
		);
		expect(out.count).toBeGreaterThan(0);
		expect(out.after).toBe(0);
	});

	it("CQRS list query and markRead command dispatch with principal authz", async () => {
		const out = await runtime.runPromise(
			Effect.provideService(
				Effect.gen(function* () {
					const bus = yield* EventBus;
					yield* bus.dispatch([PatientCreated.make({ id: 13, ownerId: "u1", name: "Listed" })]);
					const queries = yield* Query.dispatcher(NotificationsQueries);
					const commands = yield* Command.dispatcher(NotificationsCommands);
					const rows = yield* queries["notifications.list"]({ userId: "u1", limit: 1 });
					yield* commands["notifications.markRead"]({ userId: "u1", ids: rows.map((r) => r.id) });
					const after = yield* queries["notifications.list"]({ userId: "u1", limit: 1 });
					return { rows, after };
				}).pipe(Effect.scoped),
				Principal,
				{ userId: "u1" },
			),
		);
		expect(out.rows).toHaveLength(1);
		expect(out.rows[0]?.readAt).toBeNull();
		expect(out.after[0]?.readAt).toBeInstanceOf(Date);
	});

	it("markRead fans the updated row out so other streams see it read", async () => {
		const result = await runtime.runPromise(
			Effect.provideService(
				Effect.gen(function* () {
					const n = yield* Notifications;
					const bus = yield* EventBus;
					yield* bus.dispatch([PatientCreated.make({ id: 20, ownerId: "u1", name: "StreamRead" })]);
					const rows = yield* n.list("u1");
					const target = rows.find((r) => r.body === "StreamRead");
					if (target === undefined) return null;
					// A second "device": same userId stream, waiting for the
					// live read-update frame (backlog replay emits read:false
					// first and is filtered out).
					const fiber = yield* Stream.runHead(
						n.stream("u1").pipe(
							Stream.filter((item) => item.id === String(target.id) && item.read === true),
							Stream.take(1),
						),
					).pipe(Effect.forkChild);
					// Let the stream subscribe to the pubsub before publishing.
					yield* Effect.sleep("50 millis");
					yield* n.markRead("u1", [target.id]);
					return yield* Fiber.join(fiber);
				}),
				Principal,
				{ userId: "u1" },
			),
		);
		expect(result).toMatchObject({
			_tag: "Some",
			value: { read: true, meta: "patient.created" },
		});
	});

	it("command-dispatched markAllRead propagates read state to the stream", async () => {
		const result = await runtime.runPromise(
			Effect.provideService(
				Effect.gen(function* () {
					const n = yield* Notifications;
					const bus = yield* EventBus;
					const commands = yield* Command.dispatcher(NotificationsCommands);
					yield* bus.dispatch([PatientCreated.make({ id: 21, ownerId: "u1", name: "CmdRead" })]);
					const rows = yield* n.list("u1");
					const target = rows.find((r) => r.body === "CmdRead");
					if (target === undefined) return null;
					const fiber = yield* Stream.runHead(
						n.stream("u1").pipe(
							Stream.filter((item) => item.id === String(target.id) && item.read === true),
							Stream.take(1),
						),
					).pipe(Effect.forkChild);
					yield* Effect.sleep("50 millis");
					yield* commands["notifications.markAllRead"]({ userId: "u1" });
					return yield* Fiber.join(fiber);
				}).pipe(Effect.scoped),
				Principal,
				{ userId: "u1" },
			),
		);
		expect(result).toMatchObject({ _tag: "Some", value: { read: true } });
	});
});

describe("plugins", () => {
	it("declares the header action contribution", () => {
		expect(notificationsHeaderPlugin.id).toBe("notifications.header");
		expect(notificationsHeaderPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(notificationsHeaderPlugin.optionalDeps).toEqual(["platform.header"]);
		expect(notificationsHeaderPlugin.chrome).toHaveLength(1);
		expect(notificationsHeaderPlugin.chrome?.[0]).toMatchObject({
			region: "console.header.actions",
			content: { kind: "headerAction", id: "notifications" },
		});
	});

	it("declares tables and services as single-concern plugins", () => {
		expect(notificationsTablesPlugin.id).toBe("notifications.tables");
		expect(notificationsTablesPlugin.tables?.notifications).toBeDefined();
		expect(notificationsServicesPlugin.id).toBe("notifications.services");
		expect(notificationsServicesPlugin.requiredDeps).toEqual([
			"patients.services",
			"consultations.services",
		]);
		expect(notificationsServicesPlugin.services).toBeDefined();
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual([
			"notifications.header",
			"notifications.tables",
			"notifications.services",
			"notifications.routes",
		]);
	});
});

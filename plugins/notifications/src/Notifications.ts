import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

import { Db, type DbClient } from "@ktb/db";
import { requirePrincipalUser, type Forbidden } from "@ktb/authz";
import { Event, EventBus } from "@effect-server-utils/cqrs";
import { PatientCreated, PatientDeleted } from "@ktb/patients/api";
import { ConsultationCreated } from "@ktb/consultations/api";

import type { ConsoleNotification } from "./context.ts";
import { notifications } from "./schema.ts";

export type NotificationRow = typeof notifications.$inferSelect;

export interface NotificationDraft {
	readonly userId: string;
	readonly kind: string;
	readonly title: string;
	readonly body?: string;
	readonly payload?: string;
}

// ---------- repo (plain async fns; authz lives in the service/handlers) ----------

export async function listNotifications(db: DbClient, userId: string, limit?: number) {
	const where = eq(notifications.userId, userId);
	const query = db.select().from(notifications).where(where).orderBy(desc(notifications.id));
	return limit === undefined ? query : query.limit(limit);
}

export async function countUnreadNotifications(db: DbClient, userId: string) {
	const rows = await db
		.select({ n: count() })
		.from(notifications)
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
	return rows[0]?.n ?? 0;
}

export async function insertNotification(db: DbClient, draft: NotificationDraft) {
	const rows = await db
		.insert(notifications)
		.values({
			userId: draft.userId,
			kind: draft.kind,
			title: draft.title,
			body: draft.body ?? null,
			payload: draft.payload ?? null,
			createdAt: new Date(),
		})
		.returning();
	return rows[0] ?? null;
}

export async function markNotificationsRead(db: DbClient, userId: string, ids: readonly number[]) {
	if (ids.length === 0) return [];
	// `.returning()` yields only rows actually flipped (readAt was null) —
	// the service fans these out so other sessions see the read state.
	return db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notifications.userId, userId),
				inArray(notifications.id, [...ids]),
				isNull(notifications.readAt),
			),
		)
		.returning();
}

export async function markAllNotificationsRead(db: DbClient, userId: string) {
	return db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
		.returning();
}

// ---------- domain port ----------

/** Live fan-out item: the console shape plus the owning userId, which is
 * stripped before emission (ConsoleNotification is user-agnostic). */
type LiveNotification = ConsoleNotification & { readonly userId: string };

export const rowToConsole = (row: NotificationRow): ConsoleNotification => ({
	id: String(row.id),
	title: row.title,
	description: row.body ?? undefined,
	read: row.readAt !== null,
	meta: row.kind,
});

const rowToLive = (row: NotificationRow): LiveNotification => ({
	...rowToConsole(row),
	userId: row.userId,
});

const liveToConsole = ({ userId: _userId, ...rest }: LiveNotification): ConsoleNotification => rest;

/** How many persisted rows `stream` replays before switching to live. */
export const STREAM_BACKLOG = 50;

/**
 * Notifications domain port — Effect service, swappable in tests.
 *
 * Notifications are strictly per-user: every method requires the bound
 * `Principal` to be `userId` (`requirePrincipalUser` only — there is no
 * entity to permix-check and no cross-user read, so `requireCanAs` adds
 * nothing). With no principal (system context) all methods fail
 * `Forbidden`. `stream` replays the recent persisted backlog, then fans
 * out live inserts AND read-state updates for that user — every
 * connected tab/device converges on the same rows by id.
 */
export class Notifications extends Context.Service<
	Notifications,
	{
		readonly list: (userId: string, limit?: number) => Effect.Effect<NotificationRow[], Forbidden>;
		readonly unreadCount: (userId: string) => Effect.Effect<number, Forbidden>;
		readonly markRead: (userId: string, ids: readonly number[]) => Effect.Effect<void, Forbidden>;
		readonly markAllRead: (userId: string) => Effect.Effect<void, Forbidden>;
		readonly stream: (userId: string) => Stream.Stream<ConsoleNotification, Forbidden>;
	}
>()("@ktb/notifications/Notifications") {}

// ---------- event ingestion ----------

/** One entry per consumed domain event — adding a future event is a
 * single map entry here (def + projection to a notification draft). */
const mapEvent = <E extends Event.Any>(
	def: E,
	project: (event: Event.Type<E>) => NotificationDraft,
) => ({ def, project }) as const;

const NOTIFICATION_MAP = [
	mapEvent(PatientCreated, (e) => ({
		userId: e.ownerId,
		kind: "patient.created",
		title: "Patient created",
		body: e.name,
	})),
	mapEvent(PatientDeleted, (e) => ({
		userId: e.ownerId,
		kind: "patient.deleted",
		title: "Patient deleted",
	})),
	mapEvent(ConsultationCreated, (e) => ({
		userId: e.userId,
		kind: "consultation.created",
		title: "Consultation started",
		body: e.source,
	})),
];

export const NotificationsLive = Layer.effect(
	Notifications,
	Effect.gen(function* () {
		const db = yield* Db;
		const events = yield* EventBus;
		const live = yield* PubSub.unbounded<LiveNotification>();

		/** Persist then fan out — failures are logged and isolated so a bad
		 * event never propagates into the publisher or other subscribers. */
		const ingest = (draft: NotificationDraft) =>
			Effect.gen(function* () {
				const row = yield* Effect.promise(() => insertNotification(db, draft));
				if (row !== null) yield* PubSub.publish(live, rowToLive(row));
			}).pipe(Effect.catchCause((cause) => Effect.logError("notification ingest failed", cause)));

		/** Fan persisted rows out to live streams — same PubSub and item
		 * shape as inserts, so read-state updates flow through the
		 * stream's userId filter/strip unchanged. Failures are logged and
		 * isolated: the DB write already committed. */
		const publishRows = (rows: readonly NotificationRow[]) =>
			Effect.forEach(rows, (row) => PubSub.publish(live, rowToLive(row)), {
				discard: true,
			}).pipe(Effect.catchCause((cause) => Effect.logError("notification fan-out failed", cause)));

		// subscribeAfterCommit: runs after the publisher's boundary with
		// failure isolated — the right contract for a DB write that must
		// not roll back (or be rolled back by) the producing command.
		for (const { def, project } of NOTIFICATION_MAP) {
			yield* events.subscribeAfterCommit(def, (event) =>
				ingest(
					// The map is heterogeneous by design; each entry's projector
					// was typed against its own event at the mapEvent call site.
					(project as (e: Event.Type<typeof def>) => NotificationDraft)(
						event as Event.Type<typeof def>,
					),
				),
			);
		}

		return Notifications.of({
			list: Effect.fn("Notifications.list")(function* (userId: string, limit?: number) {
				yield* requirePrincipalUser(userId, "notification.read");
				return yield* Effect.promise(() => listNotifications(db, userId, limit));
			}),
			unreadCount: Effect.fn("Notifications.unreadCount")(function* (userId: string) {
				yield* requirePrincipalUser(userId, "notification.read");
				return yield* Effect.promise(() => countUnreadNotifications(db, userId));
			}),
			markRead: Effect.fn("Notifications.markRead")(function* (
				userId: string,
				ids: readonly number[],
			) {
				yield* requirePrincipalUser(userId, "notification.update");
				yield* Effect.annotateCurrentSpan({ userId, count: ids.length });
				const rows = yield* Effect.promise(() => markNotificationsRead(db, userId, ids));
				yield* publishRows(rows);
			}),
			markAllRead: Effect.fn("Notifications.markAllRead")(function* (userId: string) {
				yield* requirePrincipalUser(userId, "notification.update");
				yield* Effect.annotateCurrentSpan({ userId });
				const rows = yield* Effect.promise(() => markAllNotificationsRead(db, userId));
				yield* publishRows(rows);
			}),
			stream: (userId: string) =>
				Stream.unwrap(
					Effect.gen(function* () {
						yield* requirePrincipalUser(userId, "notification.read");
						// Backlog read happens inside the stream's first effect so
						// construction stays cheap and authz is enforced on pull.
						const rows = yield* Effect.promise(() => listNotifications(db, userId, STREAM_BACKLOG));
						return Stream.concat(
							Stream.fromIterable(rows.map(rowToConsole)),
							Stream.fromPubSub(live).pipe(
								Stream.filter((n) => n.userId === userId),
								Stream.map(liveToConsole),
							),
						);
					}),
				),
		});
	}),
);

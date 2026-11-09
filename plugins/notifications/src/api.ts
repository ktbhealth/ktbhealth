import * as Schema from "effect/Schema";
import { Command, Query } from "@effect-server-utils/cqrs";
import { Forbidden } from "@ktb/authz";

/** `Forbidden` is a `Data.TaggedError`, not a `Schema` — declare a schema
 * view of it so command failures stay typed end to end. */
const ForbiddenSchema = Schema.declare<Forbidden>((u): u is Forbidden => u instanceof Forbidden);

/** Persisted notification row as exposed to CQRS consumers. */
export const NotificationRow = Schema.Struct({
	id: Schema.Number,
	userId: Schema.String,
	kind: Schema.String,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	payload: Schema.NullOr(Schema.String),
	readAt: Schema.NullOr(Schema.Date),
	createdAt: Schema.Date,
});

/** Cross-plugin surface for notifications — queries via
 * `Query.dispatcher`, commands via `Command.dispatcher`. Handlers
 * enforce the same principal check as the `Notifications` service. */
export const NotificationsList = Query.make("notifications.list", {
	payload: { userId: Schema.String, limit: Schema.optionalKey(Schema.Number) },
	success: Schema.Array(NotificationRow),
});

export const NotificationsUnreadCount = Query.make("notifications.unreadCount", {
	payload: { userId: Schema.String },
	success: Schema.Number,
});

export const NotificationsQueries = Query.group(NotificationsList, NotificationsUnreadCount);

export const NotificationsMarkRead = Command.make("notifications.markRead", {
	payload: { userId: Schema.String, ids: Schema.Array(Schema.Number) },
	success: Schema.Void,
	failure: ForbiddenSchema,
});

export const NotificationsMarkAllRead = Command.make("notifications.markAllRead", {
	payload: { userId: Schema.String },
	success: Schema.Void,
	failure: ForbiddenSchema,
});

export const NotificationsCommands = Command.group(NotificationsMarkRead, NotificationsMarkAllRead);

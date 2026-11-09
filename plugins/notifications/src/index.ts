import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Db } from "@ktb/db";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { platformPanelPlugin } from "@ktb/platform";
import { platformHeaderPlugin } from "@ktb/platform-header";
import { patientsServicesPlugin } from "@ktb/patients";
import { consultationsServicesPlugin } from "@ktb/consultations";
import { Command, Query } from "@effect-server-utils/cqrs";
import { requirePrincipalUser } from "@ktb/authz";

import {
	countUnreadNotifications,
	listNotifications,
	markAllNotificationsRead,
	markNotificationsRead,
	NotificationsLive,
} from "./Notifications.ts";
import { NotificationsCommands, NotificationsQueries } from "./api.ts";
import { notifications } from "./schema.ts";

import { NotificationsHeaderAction } from "./views/NotificationsHeaderAction.tsx";

/**
 * Console notifications: contributes a header action (bell icon +
 * unread badge + popover) to the /platform top bar. Like jobs, the
 * action only renders when the `platform.header` extension point is
 * present; notification data reaches the component through
 * NotificationsDataContext, which a host route provides once a
 * notifications backend exists.
 */
export const notificationsHeaderPlugin = definePlugin({
	id: "notifications.header",
	requiredDeps: [platformPanelPlugin.id],
	optionalDeps: [platformHeaderPlugin.id],
	panel: {
		headerActions: [{ id: "notifications", component: NotificationsHeaderAction }],
	},
});

export const notificationsTablesPlugin = definePlugin({
	id: "notifications.tables",
	tables: { notifications },
});

/** Cross-plugin query surface — registered on the app query bus so other
 * plugins can `Query.dispatcher(NotificationsQueries)` against it.
 * Raw repo reads like `patients.ownerOf`: query handlers cannot fail, so
 * authz is the caller's concern — user-facing reads MUST go through the
 * `Notifications` service (or these commands), which enforce
 * `requirePrincipalUser`. */
export const NotificationsQueriesLive = Query.handlersOf(NotificationsQueries, {
	"notifications.list": ({ userId, limit }) =>
		Effect.gen(function* () {
			const db = yield* Db;
			return yield* Effect.promise(() => listNotifications(db, userId, limit));
		}),
	"notifications.unreadCount": ({ userId }) =>
		Effect.gen(function* () {
			const db = yield* Db;
			return yield* Effect.promise(() => countUnreadNotifications(db, userId));
		}),
});

/** `notifications.markRead` / `notifications.markAllRead` commands —
 * same principal check as the service (notifications are per-user, so
 * `requirePrincipalUser` is the whole authz story). */
export const NotificationsCommandsLive = Command.handlersOf(NotificationsCommands, {
	"notifications.markRead": ({ userId, ids }) =>
		Effect.gen(function* () {
			yield* requirePrincipalUser(userId, "notification.update");
			const db = yield* Db;
			return yield* Effect.promise(() => markNotificationsRead(db, userId, ids));
		}),
	"notifications.markAllRead": ({ userId }) =>
		Effect.gen(function* () {
			yield* requirePrincipalUser(userId, "notification.update");
			const db = yield* Db;
			return yield* Effect.promise(() => markAllNotificationsRead(db, userId));
		}),
});

export const notificationsServicesPlugin = definePlugin({
	id: "notifications.services",
	// Subscribes to patient/consultation domain events — the dep edges
	// order those plugins' layers (and their event producers) first.
	requiredDeps: [patientsServicesPlugin.id, consultationsServicesPlugin.id],
	services: Layer.mergeAll(NotificationsLive, NotificationsQueriesLive, NotificationsCommandsLive),
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	notificationsHeaderPlugin,
	notificationsTablesPlugin,
	notificationsServicesPlugin,
];

export {
	Notifications,
	NotificationsLive,
	STREAM_BACKLOG,
	countUnreadNotifications,
	insertNotification,
	listNotifications,
	markAllNotificationsRead,
	markNotificationsRead,
	rowToConsole,
	type NotificationDraft,
	type NotificationRow,
} from "./Notifications.ts";
export {
	NotificationsCommands,
	NotificationsList,
	NotificationsMarkAllRead,
	NotificationsMarkRead,
	NotificationsQueries,
	NotificationsUnreadCount,
	NotificationRow as NotificationRowSchema,
} from "./api.ts";
export { notifications } from "./schema.ts";
export {
	NotificationsActionsContext,
	NotificationsDataContext,
	type ConsoleNotification,
	type NotificationsActions,
} from "./context.ts";

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"notifications.header": true;
		"notifications.tables": true;
		"notifications.services": true;
	}
}

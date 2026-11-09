import { createContext } from "react";

/**
 * One console notification. Serializable — a future notifications
 * service/host loader maps domain events into this shape and provides
 * it via NotificationsDataContext; the header action never fetches.
 */
export interface ConsoleNotification {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly read?: boolean;
	readonly meta?: string;
}

/** Notifications feed for the current console session — empty until a
 * host provides data. */
export const NotificationsDataContext = createContext<readonly ConsoleNotification[]>([]);

/**
 * Host-injected write path for the notifications popover. Plugins never
 * import server fns — the host route provides implementations that call
 * them and resolve `true` on success. `null` (the default) means no
 * backend is wired: the UI hides read affordances rather than offering
 * dead buttons.
 */
export interface NotificationsActions {
	/** Mark the given notification ids read. Ids are the numeric row ids
	 * behind `ConsoleNotification.id` (stringified for serialization). */
	readonly markRead: (ids: readonly number[]) => Promise<boolean>;
	readonly markAllRead: () => Promise<boolean>;
}

export const NotificationsActionsContext = createContext<NotificationsActions | null>(null);

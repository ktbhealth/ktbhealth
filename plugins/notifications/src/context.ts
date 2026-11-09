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

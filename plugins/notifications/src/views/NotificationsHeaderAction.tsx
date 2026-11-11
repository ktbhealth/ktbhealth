import * as React from "react";
import { BellIcon } from "lucide-react";

import { Button } from "@ktbhealth/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@ktbhealth/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@ktbhealth/ui/components/tooltip";

import {
	NotificationsActionsContext,
	NotificationsDataContext,
	type ConsoleNotification,
	type NotificationsActions,
} from "../context.ts";
import { notificationMessages } from "../i18n.ts";

const NotificationBody = ({ notification }: { notification: ConsoleNotification }) => (
	<>
		<span
			className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
				notification.read ? "bg-transparent" : "bg-primary"
			}`}
		/>
		<div className="min-w-0">
			<p className="truncate text-sm">{notification.title}</p>
			{notification.description ? (
				<p className="truncate text-xs text-muted-foreground">{notification.description}</p>
			) : null}
			{notification.meta ? (
				<p className="mt-0.5 text-[11px] text-muted-foreground/70">{notification.meta}</p>
			) : null}
		</div>
	</>
);

const NotificationRow = ({
	notification,
	onMarkRead,
	markAsReadLabel,
}: {
	notification: ConsoleNotification;
	/** Present only for unread rows when the host wired mark-read actions. */
	onMarkRead?: () => void;
	markAsReadLabel: string;
}) =>
	onMarkRead ? (
		<li>
			<button
				type="button"
				onClick={onMarkRead}
				className="flex w-full gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60"
				aria-label={markAsReadLabel}
			>
				<NotificationBody notification={notification} />
			</button>
		</li>
	) : (
		<li className="flex gap-2.5 rounded-md px-2 py-2">
			<NotificationBody notification={notification} />
		</li>
	);

/** Numeric ids sort newest-first; non-numeric ids keep arrival order. */
const byIdDesc = (a: ConsoleNotification, b: ConsoleNotification) => {
	const x = Number(a.id);
	const y = Number(b.id);
	return Number.isFinite(x) && Number.isFinite(y) ? y - x : 0;
};

/** Upsert by id: backlog replays replace seeded rows in place, live
 * arrivals land on top. */
const mergeNotification = (
	list: readonly ConsoleNotification[],
	notification: ConsoleNotification,
): readonly ConsoleNotification[] => {
	const idx = list.findIndex((n) => n.id === notification.id);
	const next =
		idx >= 0 ? list.map((n, i) => (i === idx ? notification : n)) : [notification, ...list];
	return [...next].sort(byIdDesc);
};

/** Flip the given ids to read — used to reflect a successful mark-read
 * call before the next SSE frame or reload confirms it. */
const markIdsRead = (
	list: readonly ConsoleNotification[],
	ids: ReadonlySet<string>,
): readonly ConsoleNotification[] => list.map((n) => (ids.has(n.id) ? { ...n, read: true } : n));

/**
 * Header action contributed via `console.header.actions` chrome: a tooltip'd bell
 * button with an unread-count badge opening a popover with the console
 * notifications feed. The host seeds the list through
 * NotificationsDataContext (SSR/loader data); when EventSource is
 * available the component opens /api/notifications, whose stream replays
 * the same backlog (deduped by id) and then pushes live inserts. Without
 * EventSource (tests/jsdom) the context data renders as-is. When the
 * host also provides NotificationsActionsContext, unread rows become
 * click-to-mark-read and the header offers "mark all read". Renders only
 * when the `platform.header` extension point is present.
 */
export function NotificationsHeaderAction({ locale = "en" }: { locale?: string }) {
	const t = notificationMessages(locale);
	const seeded = React.useContext(NotificationsDataContext);
	const actions = React.useContext(NotificationsActionsContext);
	// null → context seed is authoritative (no live connection yet/ever).
	const [live, setLive] = React.useState<readonly ConsoleNotification[] | null>(null);
	const notifications = live ?? seeded;
	const unread = notifications.filter((n) => !n.read).length;

	React.useEffect(() => {
		if (typeof EventSource === "undefined") return;
		const source = new EventSource("/api/notifications");
		// `live` stays null until the first frame: the context seed already
		// renders, and the SSE backlog replays the same rows — mergeNotification
		// dedupes them by id.
		source.onmessage = (event) => {
			try {
				const notification = JSON.parse(event.data) as ConsoleNotification;
				setLive((prev) => mergeNotification(prev ?? seeded, notification));
			} catch {
				// Malformed frame — ignore.
			}
		};
		return () => source.close();
	}, [seeded]);

	/** Apply a successful mark-read to whichever list is authoritative,
	 * materializing `live` from the seed on first write. */
	const applyRead = (ids: ReadonlySet<string>) =>
		setLive((prev) => markIdsRead(prev ?? seeded, ids));

	const markRead = (actions: NotificationsActions, notification: ConsoleNotification) => {
		const id = Number(notification.id);
		if (!Number.isFinite(id)) return;
		void actions.markRead([id]).then((ok) => {
			if (ok) applyRead(new Set([notification.id]));
		});
	};

	const markAllRead = (actions: NotificationsActions) => {
		void actions.markAllRead().then((ok) => {
			if (ok) applyRead(new Set(notifications.map((n) => n.id)));
		});
	};

	return (
		<TooltipProvider>
			<Popover>
				<Tooltip>
					<TooltipTrigger
						render={
							<PopoverTrigger
								render={
									<Button variant="ghost" size="icon" className="relative" aria-label={t.label} />
								}
							/>
						}
					>
						<BellIcon className="size-4" />
						{unread > 0 ? (
							<span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-destructive-foreground">
								{unread}
							</span>
						) : null}
					</TooltipTrigger>
					<TooltipContent>{t.label}</TooltipContent>
				</Tooltip>
				<PopoverContent align="end" className="w-80 p-0">
					<PopoverHeader className="border-b border-border px-3 py-2">
						<PopoverTitle className="flex items-center justify-between text-sm">
							<span>{t.label}</span>
							{unread > 0 ? (
								actions ? (
									<span className="flex items-center gap-2">
										<span className="text-xs font-normal text-muted-foreground">
											{t.unreadCount(unread)}
										</span>
										<Button
											variant="ghost"
											size="xs"
											className="h-6 px-2 text-xs"
											onClick={() => markAllRead(actions)}
										>
											{t.markAllRead}
										</Button>
									</span>
								) : (
									<span className="text-xs font-normal text-muted-foreground">
										{t.unreadCount(unread)}
									</span>
								)
							) : null}
						</PopoverTitle>
					</PopoverHeader>
					{notifications.length > 0 ? (
						<ul className="max-h-80 divide-y divide-border overflow-auto">
							{notifications.map((n) => (
								<NotificationRow
									key={n.id}
									notification={n}
									onMarkRead={actions && !n.read ? () => markRead(actions, n) : undefined}
									markAsReadLabel={t.markAsRead(n.title)}
								/>
							))}
						</ul>
					) : (
						<p className="px-3 py-8 text-center text-sm text-muted-foreground">{t.empty}</p>
					)}
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	);
}

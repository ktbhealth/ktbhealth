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

import { NotificationsDataContext, type ConsoleNotification } from "../context.ts";

const NotificationRow = ({ notification }: { notification: ConsoleNotification }) => (
	<li className="flex gap-2.5 rounded-md px-2 py-2">
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
	</li>
);

/**
 * Header action contributed via `panel.headerActions`: a tooltip'd bell
 * button with an unread-count badge opening a popover with the console
 * notifications feed. Data comes from NotificationsDataContext (the
 * host injects it once a notifications backend exists); empty state
 * otherwise. Renders only when the `platform.header` extension point
 * is present.
 */
export function NotificationsHeaderAction() {
	const notifications = React.useContext(NotificationsDataContext);
	const unread = notifications.filter((n) => !n.read).length;

	return (
		<TooltipProvider>
			<Popover>
				<Tooltip>
					<TooltipTrigger
						render={
							<PopoverTrigger
								render={
									<Button
										variant="ghost"
										size="icon"
										className="relative"
										aria-label="Notifications"
									/>
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
					<TooltipContent>Notifications</TooltipContent>
				</Tooltip>
				<PopoverContent align="end" className="w-80 p-0">
					<PopoverHeader className="border-b border-border px-3 py-2">
						<PopoverTitle className="flex items-center justify-between text-sm">
							<span>Notifications</span>
							{unread > 0 ? (
								<span className="text-xs font-normal text-muted-foreground">{unread} unread</span>
							) : null}
						</PopoverTitle>
					</PopoverHeader>
					{notifications.length > 0 ? (
						<ul className="max-h-80 divide-y divide-border overflow-auto">
							{notifications.map((n) => (
								<NotificationRow key={n.id} notification={n} />
							))}
						</ul>
					) : (
						<p className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications</p>
					)}
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	);
}

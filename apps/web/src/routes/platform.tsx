import { createElement } from "react";
import {
	createFileRoute,
	getRouteApi,
	notFound,
	Outlet,
	useLocation,
} from "@tanstack/react-router";

import { authClient } from "@ktb/auth-better/client";
import { platformHeaderPlugin } from "@ktb/platform-header";
import { PlatformConsoleShell } from "@ktb/platform-sidebar/views";
import { JobsDataContext, jobsFromAudioRows } from "@ktb/jobs";
import {
	NotificationsActionsContext,
	NotificationsDataContext,
	type NotificationsActions,
} from "@ktb/notifications/context";

import {
	adminListAudioJobsFn,
	listMyNotificationsFn,
	markAllMyNotificationsReadFn,
	markMyNotificationsReadFn,
	platformAdminFn,
} from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";
import { plugins } from "#/plugins.ts";

// /platform console shell (P-031): a system console, not an app page —
// the root route drops its marketing chrome on /platform* and this
// layout owns the full viewport. The chrome itself (sidebar, breadcrumb
// header, sign-out) is the platform-sidebar plugin's view; this route
// keeps the admin gate and injects the aggregated panel.sidebar items.
// The gate is server-side — non-admins get a hard 404, never just
// hidden nav.
//
// Header widgets: when the platform.header extension-point plugin is
// registered, every plugin's `panel.headerActions` render on the right
// side of the top bar. The jobs feed is provided through
// JobsDataContext, fed by the `consultations.audioJobs` CQRS query
// (dispatched by adminListAudioJobsFn — the jobs plugin never reaches
// into consultations tables); the notifications feed is seeded through
// NotificationsDataContext, kept live by the header action's
// /api/notifications EventSource, and gets mark-read actions through
// NotificationsActionsContext (only when the notifications backend is
// registered). Plugins without header actions are unaffected.
const headerEnabled = plugins.some((p) => p.id === platformHeaderPlugin.id);
const hasJobsPlugin = plugins.some((p) => p.id === "jobs.header");
const hasNotificationsPlugin = plugins.some((p) => p.id === "notifications.services");

export const Route = createFileRoute("/platform")({
	beforeLoad: async () => {
		await requireSession();
		if (!(await platformAdminFn())) throw notFound();
	},
	loader: async () => ({
		audioJobs: hasJobsPlugin ? await adminListAudioJobsFn() : [],
		notifications: hasNotificationsPlugin ? await listMyNotificationsFn() : [],
	}),
	component: PlatformLayout,
});

const rootApi = getRouteApi("__root__");

function PlatformLayout() {
	const pathname = useLocation({ select: (l) => l.pathname });
	const user = rootApi.useLoaderData();
	const { audioJobs, notifications } = Route.useLoaderData();
	const items = plugins.flatMap((p) => p.panel?.sidebar ?? []);
	const headerActions = headerEnabled
		? plugins
				.flatMap((p) => p.panel?.headerActions ?? [])
				.map(({ id, component }) => createElement(component, { key: id }))
		: undefined;
	// Host-injected write path for the notifications popover — plugins
	// never import server fns; the context stays null when the
	// notifications backend isn't registered so the UI hides the
	// affordances instead of offering dead buttons.
	const notificationActions: NotificationsActions | null = hasNotificationsPlugin
		? {
				markRead: (ids) => markMyNotificationsReadFn({ data: [...ids] }),
				markAllRead: () => markAllMyNotificationsReadFn(),
			}
		: null;
	return (
		<JobsDataContext.Provider value={jobsFromAudioRows(audioJobs)}>
			<NotificationsDataContext.Provider value={notifications}>
				<NotificationsActionsContext.Provider value={notificationActions}>
					<PlatformConsoleShell
						items={items}
						pathname={pathname}
						userEmail={user?.email}
						headerActions={headerActions}
						onSignOut={async () => {
							await authClient.signOut();
							window.location.assign("/");
						}}
					>
						<Outlet />
					</PlatformConsoleShell>
				</NotificationsActionsContext.Provider>
			</NotificationsDataContext.Provider>
		</JobsDataContext.Provider>
	);
}

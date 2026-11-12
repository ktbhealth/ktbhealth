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
	pluginStatesFn,
} from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";
import { pluginPanelGroup, pluginPanelLabel } from "#/lib/i18n.ts";
import {
	collectChrome,
	enabledIdSet,
	enabledPlugins,
	KNOWN_CHROME_REGIONS,
	packageEnabled,
	warnUnknownChromeRegions,
} from "#/lib/registry.ts";
import { plugins } from "#/plugins.ts";
import { getLocale } from "#/paraglide/runtime.js";

// /platform console shell (P-031): a system console, not an app page —
// the root route drops its marketing chrome on /platform* and this
// layout owns the full viewport. The chrome itself (sidebar, breadcrumb
// header, sign-out) is the platform-sidebar plugin's view; this route
// keeps the admin gate and injects the aggregated console.sidebar chrome items.
// The gate is server-side — non-admins get a hard 404, never just
// hidden nav.
//
// Header widgets: when the platform.header extension-point plugin is
// registered, every plugin's `console.header.actions` chrome render on the right
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

// This shell declares the console.* chrome regions (P-060); plugins
// fill them via `chrome` contributions. The dev warning uses the union
// of all shell regions so app.* contributions aren't false positives.
if (import.meta.env.DEV) warnUnknownChromeRegions(plugins, KNOWN_CHROME_REGIONS);

export const Route = createFileRoute("/platform")({
	beforeLoad: async () => {
		await requireSession();
		if (!(await platformAdminFn())) throw notFound();
	},
	loader: async () => {
		// Enabled-state gate (P-058): skip feeds whose plugin package is
		// fully disabled — the CQRS/service calls would fail or return
		// data for a plugin the admin turned off.
		const pluginStates = await pluginStatesFn();
		const enabled = enabledIdSet(pluginStates);
		return {
			audioJobs:
				hasJobsPlugin && packageEnabled(enabled, "consultations")
					? await adminListAudioJobsFn()
					: [],
			notifications:
				hasNotificationsPlugin && packageEnabled(enabled, "notifications")
					? await listMyNotificationsFn()
					: [],
		};
	},
	component: PlatformLayout,
});

const rootApi = getRouteApi("__root__");

function PlatformLayout() {
	const pathname = useLocation({ select: (l) => l.pathname });
	const { user, pluginStates } = rootApi.useLoaderData();
	const { audioJobs, notifications } = Route.useLoaderData();
	const locale = getLocale();
	// Enabled-state filter (P-058): disabled plugins contribute no
	// sidebar items or header actions.
	const visiblePlugins = enabledPlugins(plugins, enabledIdSet(pluginStates));
	// Sidebar/header chrome comes from `chrome` contributions into the
	// console.* regions (P-060), filtered by `when` against the pathname.
	// Sidebar labels/groups are plugin-declared English strings; the host
	// maps the known destinations/groups to localized chrome (same
	// mechanism as the landing nav's pluginNavLabel).
	const items = collectChrome(visiblePlugins, "console.sidebar", pathname).flatMap((entry) =>
		entry.content.kind === "sidebarItem"
			? [
					{
						...entry.content.item,
						label: pluginPanelLabel(entry.content.item.to, entry.content.item.label),
						...(entry.content.item.group !== undefined
							? { group: pluginPanelGroup(entry.content.item.group) }
							: {}),
					},
				]
			: [],
	);
	const headerActions = headerEnabled
		? collectChrome(visiblePlugins, "console.header.actions", pathname).flatMap((entry) =>
				entry.content.kind === "headerAction"
					? [createElement(entry.content.component, { key: entry.content.id, locale })]
					: [],
			)
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
		<JobsDataContext.Provider value={jobsFromAudioRows(audioJobs, locale)}>
			<NotificationsDataContext.Provider value={notifications}>
				<NotificationsActionsContext.Provider value={notificationActions}>
					<PlatformConsoleShell
						items={items}
						pathname={pathname}
						locale={locale}
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

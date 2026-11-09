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

import { adminListConsultationsFn, platformAdminFn } from "#/lib/fns.ts";
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
// JobsDataContext, fed by the consultations admin list (the only jobs
// source today); plugins without header actions are unaffected.
const headerEnabled = plugins.some((p) => p.id === platformHeaderPlugin.id);
const hasJobsPlugin = plugins.some((p) => p.id === "jobs.header");

export const Route = createFileRoute("/platform")({
	beforeLoad: async () => {
		await requireSession();
		if (!(await platformAdminFn())) throw notFound();
	},
	loader: () => (hasJobsPlugin ? adminListConsultationsFn() : Promise.resolve([])),
	component: PlatformLayout,
});

const rootApi = getRouteApi("__root__");

function PlatformLayout() {
	const pathname = useLocation({ select: (l) => l.pathname });
	const user = rootApi.useLoaderData();
	const consultations = Route.useLoaderData();
	const items = plugins.flatMap((p) => p.panel?.sidebar ?? []);
	const headerActions = headerEnabled
		? plugins
				.flatMap((p) => p.panel?.headerActions ?? [])
				.map(({ id, component }) => createElement(component, { key: id }))
		: undefined;
	return (
		<JobsDataContext.Provider value={jobsFromAudioRows(consultations)}>
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
		</JobsDataContext.Provider>
	);
}

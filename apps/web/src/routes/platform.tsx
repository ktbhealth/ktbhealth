import {
	createFileRoute,
	getRouteApi,
	notFound,
	Outlet,
	useLocation,
} from "@tanstack/react-router";

import { authClient } from "@ktb/auth-better/client";
import { PlatformConsoleShell } from "@ktb/platform-sidebar/views";

import { platformAdminFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";
import { plugins } from "#/plugins.ts";

// /platform console shell (P-031): a system console, not an app page —
// the root route drops its marketing chrome on /platform* and this
// layout owns the full viewport. The chrome itself (sidebar, breadcrumb
// header, sign-out) is the platform-sidebar plugin's view; this route
// keeps the admin gate and injects the aggregated panel.sidebar items.
// The gate is server-side — non-admins get a hard 404, never just
// hidden nav.
export const Route = createFileRoute("/platform")({
	beforeLoad: async () => {
		await requireSession();
		if (!(await platformAdminFn())) throw notFound();
	},
	component: PlatformLayout,
});

const rootApi = getRouteApi("__root__");

function PlatformLayout() {
	const pathname = useLocation({ select: (l) => l.pathname });
	const user = rootApi.useLoaderData();
	const items = plugins.flatMap((p) => p.panel?.sidebar ?? []);
	return (
		<PlatformConsoleShell
			items={items}
			pathname={pathname}
			userEmail={user?.email}
			onSignOut={async () => {
				await authClient.signOut();
				window.location.assign("/");
			}}
		>
			<Outlet />
		</PlatformConsoleShell>
	);
}

import { createFileRoute } from "@tanstack/react-router";

import { AdminGroupsPage } from "@ktb/groups/views";
import { adminListGroupsFn } from "#/lib/fns.ts";

// Mounted under the /platform layout (physical subtree owned by the
// platform plugin) — the layout's beforeLoad already hard-404s
// non-admins; Groups.list re-checks the gate inside the service.
export const Route = createFileRoute("/platform/groups")({
	loader: () => adminListGroupsFn(),
	component: function PlatformGroupsRoute() {
		const groups = Route.useLoaderData();
		return <AdminGroupsPage groups={groups} />;
	},
});

import { createFileRoute } from "@tanstack/react-router";

import { AdminUsersPage } from "@ktb/users/views";
import { adminListUsersFn } from "#/lib/fns.ts";

// Mounted under the /platform layout (physical subtree owned by the
// platform plugin) — the layout's beforeLoad already hard-404s
// non-admins; adminList re-checks the gate inside the service.
export const Route = createFileRoute("/platform/users")({
	loader: () => adminListUsersFn(),
	component: function PlatformUsersRoute() {
		const users = Route.useLoaderData();
		return <AdminUsersPage users={users} />;
	},
});

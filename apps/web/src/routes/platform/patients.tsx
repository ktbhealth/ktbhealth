import { createFileRoute } from "@tanstack/react-router";

import { AdminPatientsPage } from "@ktb/patients/views";
import { adminListPatientsFn } from "#/lib/fns.ts";

// Mounted under the /platform layout (physical subtree owned by the
// platform plugin) — the layout's beforeLoad already hard-404s
// non-admins; adminList re-checks the gate inside the service.
export const Route = createFileRoute("/platform/patients")({
	loader: () => adminListPatientsFn(),
	component: function PlatformPatientsRoute() {
		const patients = Route.useLoaderData();
		return <AdminPatientsPage patients={patients} />;
	},
});

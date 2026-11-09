import { createFileRoute } from "@tanstack/react-router";

import { AdminConsultationsPage } from "@ktb/consultations/views";
import { adminListConsultationsFn } from "#/lib/fns.ts";

// Mounted under the /platform layout (physical subtree owned by the
// platform plugin) — the layout's beforeLoad already hard-404s
// non-admins; adminList re-checks the gate inside the service.
export const Route = createFileRoute("/platform/consultations")({
	loader: () => adminListConsultationsFn(),
	component: function PlatformConsultationsRoute() {
		const consultations = Route.useLoaderData();
		return <AdminConsultationsPage consultations={consultations} />;
	},
});

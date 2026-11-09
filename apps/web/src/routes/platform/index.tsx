import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "@ktb/dashboard/views";
import { adminListConsultationsFn, adminListPatientsFn } from "#/lib/fns.ts";
import { plugins } from "#/plugins.ts";

export const Route = createFileRoute("/platform/")({
	loader: async () => {
		const [patients, consultations] = await Promise.all([
			adminListPatientsFn(),
			adminListConsultationsFn(),
		]);
		return { patients, consultations };
	},
	component: function PlatformIndexRoute() {
		const { patients, consultations } = Route.useLoaderData();
		return <DashboardPage patients={patients} consultations={consultations} plugins={plugins} />;
	},
});

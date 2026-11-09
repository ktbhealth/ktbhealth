import { createFileRoute } from "@tanstack/react-router";

import { PatientsPage } from "@ktb/patients/views";
import { listPatientsFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";

export const Route = createFileRoute("/patients/")({
	beforeLoad: () => requireSession(),
	loader: () => listPatientsFn(),
	component: function PatientsRoute() {
		const patients = Route.useLoaderData();
		return <PatientsPage patients={patients} />;
	},
});

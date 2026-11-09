import { createFileRoute, useRouter } from "@tanstack/react-router";

import { PatientsPage } from "@ktb/patients/views";
import { listPatientsFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";
import { patientDeleteApi } from "./-delete-api.ts";
import { getLocale } from "#/paraglide/runtime.js";

export const Route = createFileRoute("/patients/")({
	beforeLoad: () => requireSession(),
	loader: () => listPatientsFn(),
	component: function PatientsRoute() {
		const patients = Route.useLoaderData();
		const router = useRouter();
		return (
			<PatientsPage
				patients={patients}
				locale={getLocale()}
				deleteApi={patientDeleteApi}
				onDeleted={() => void router.invalidate()}
			/>
		);
	},
});

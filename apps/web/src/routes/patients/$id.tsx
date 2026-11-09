import { createFileRoute, notFound } from "@tanstack/react-router";

import { PatientDetailPage } from "@ktb/patients/views";
import { getPatientFn, listPatientConsultationsFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";

export const Route = createFileRoute("/patients/$id/")({
	staleTime: 30_000,
	beforeLoad: () => requireSession(),
	loader: async ({ params }) => {
		const id = Number(params.id);
		const [patient, consultations] = await Promise.all([
			getPatientFn({ data: id }),
			listPatientConsultationsFn({ data: id }),
		]);
		if (!patient) throw notFound();
		return { patient, consultations };
	},
	component: function PatientRoute() {
		const { patient, consultations } = Route.useLoaderData();
		return <PatientDetailPage patient={patient} consultations={consultations} />;
	},
});

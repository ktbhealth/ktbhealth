import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";

import { PatientFormPage, type PatientFormApi } from "@ktb/patients/views";
import { getPatientFn, updatePatientFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";

export const editPatientApi = (id: number): PatientFormApi => ({
	save: (draft) => updatePatientFn({ data: { ...draft, id } }),
});

export const Route = createFileRoute("/patients/$id/edit")({
	beforeLoad: () => requireSession(),
	loader: async ({ params }) => {
		const patient = await getPatientFn({ data: Number(params.id) });
		if (!patient) throw notFound();
		return patient;
	},
	component: function EditPatientRoute() {
		const patient = Route.useLoaderData();
		const navigate = useNavigate();
		return (
			<PatientFormPage
				patient={patient}
				api={editPatientApi(patient.id)}
				onSaved={(id) => navigate({ to: "/patients/$id", params: { id: String(id) } })}
			/>
		);
	},
});

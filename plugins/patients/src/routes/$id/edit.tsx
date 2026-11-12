import { notFound, useNavigate } from "@tanstack/react-router";

import { createPluginFileRoute } from "@ktb/server-fns";

import { PatientFormPage } from "../../views/index.ts";
import { getPatientFn, localeFn } from "../../fns.ts";
import { editPatientApi } from "../../apis.ts";
import { requireDoctor } from "../../guard.ts";

export const Route = createPluginFileRoute("patients.routes")("/patients/$id/edit")({
	beforeLoad: () => requireDoctor(),
	loader: async ({ params }) => {
		const id = Number(params.id);
		// Same NaN guard as the detail route — bad ids are a 404, not a 500.
		if (!Number.isInteger(id) || id <= 0) throw notFound();
		const [patient, locale] = await Promise.all([getPatientFn({ data: id }), localeFn()]);
		if (!patient) throw notFound();
		return { patient, locale };
	},
	component: function EditPatientRoute() {
		const { patient, locale } = Route.useLoaderData();
		const navigate = useNavigate();
		return (
			<PatientFormPage
				patient={patient}
				api={editPatientApi(patient.id)}
				locale={locale}
				onSaved={(id) => navigate({ to: "/patients/$id", params: { id: String(id) } })}
			/>
		);
	},
});

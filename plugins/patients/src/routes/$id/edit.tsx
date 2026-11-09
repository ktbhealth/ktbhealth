import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";

import { PatientFormPage } from "../../views/index.ts";
import { getPatientFn, localeFn } from "../../fns.ts";
import { editPatientApi } from "../../apis.ts";
import { requireSession } from "../../guard.ts";

export const Route = createFileRoute("/patients/$id/edit")({
	beforeLoad: () => requireSession(),
	loader: async ({ params }) => {
		const [patient, locale] = await Promise.all([
			getPatientFn({ data: Number(params.id) }),
			localeFn(),
		]);
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

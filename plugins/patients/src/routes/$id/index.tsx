import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";

import { PatientDetailPage } from "../../views/index.ts";
import { getPatientFn, localeFn, patientConsultationsFn } from "../../fns.ts";
import { requireSession } from "../../guard.ts";
import { patientDeleteApi } from "../../apis.ts";

export const Route = createFileRoute("/patients/$id/")({
	staleTime: 30_000,
	beforeLoad: () => requireSession(),
	loader: async ({ params }) => {
		const id = Number(params.id);
		const [patient, consultations, locale] = await Promise.all([
			getPatientFn({ data: id }),
			patientConsultationsFn({ data: id }),
			localeFn(),
		]);
		if (!patient) throw notFound();
		return { patient, consultations, locale };
	},
	component: function PatientRoute() {
		const { patient, consultations, locale } = Route.useLoaderData();
		const navigate = useNavigate();
		return (
			<PatientDetailPage
				patient={patient}
				consultations={consultations}
				locale={locale}
				deleteApi={patientDeleteApi}
				onDeleted={() => void navigate({ to: "/patients" })}
			/>
		);
	},
});

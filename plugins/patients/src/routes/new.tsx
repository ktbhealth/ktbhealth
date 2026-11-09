import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { PatientFormPage } from "../views/index.ts";
import { localeFn } from "../fns.ts";
import { newPatientApi } from "../apis.ts";
import { requireSession } from "../guard.ts";

export const Route = createFileRoute("/patients/new")({
	beforeLoad: () => requireSession(),
	loader: () => localeFn(),
	component: function NewPatientRoute() {
		const locale = Route.useLoaderData();
		const navigate = useNavigate();
		return (
			<PatientFormPage
				api={newPatientApi}
				locale={locale}
				onSaved={(id) => navigate({ to: "/patients/$id", params: { id: String(id) } })}
			/>
		);
	},
});

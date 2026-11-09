import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { PatientFormPage, type PatientFormApi } from "@ktb/patients/views";
import { createPatientFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";
import { getLocale } from "#/paraglide/runtime.js";

export const newPatientApi: PatientFormApi = {
	save: (draft) => createPatientFn({ data: draft }),
};

export const Route = createFileRoute("/patients/new")({
	beforeLoad: () => requireSession(),
	component: function NewPatientRoute() {
		const navigate = useNavigate();
		return (
			<PatientFormPage
				api={newPatientApi}
				locale={getLocale()}
				onSaved={(id) => navigate({ to: "/patients/$id", params: { id: String(id) } })}
			/>
		);
	},
});

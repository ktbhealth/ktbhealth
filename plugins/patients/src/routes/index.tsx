import { createFileRoute, useRouter } from "@tanstack/react-router";

import { PatientsPage } from "../views/index.ts";
import { localeFn, listPatientsFn } from "../fns.ts";
import { requireSession } from "../guard.ts";
import { patientDeleteApi } from "../apis.ts";

export const Route = createFileRoute("/patients/")({
	beforeLoad: () => requireSession(),
	loader: async () => {
		const [patients, locale] = await Promise.all([listPatientsFn(), localeFn()]);
		return { patients, locale };
	},
	component: function PatientsRoute() {
		const { patients, locale } = Route.useLoaderData();
		const router = useRouter();
		return (
			<PatientsPage
				patients={patients}
				locale={locale}
				deleteApi={patientDeleteApi}
				onDeleted={() => void router.invalidate()}
			/>
		);
	},
});

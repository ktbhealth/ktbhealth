import { notFound, redirect, useRouter } from "@tanstack/react-router";

import { createPluginFileRoute } from "@ktb/server-fns";

import { PatientAccessPage, type PatientAccessApi } from "../views/index.ts";
import {
	approvePatientLinkFn,
	doctorAccessFn,
	invitePatientFn,
	localeFn,
	patientLinksFn,
	revokePatientLinkFn,
} from "../fns.ts";

// Portal access of one patient: who may open the record in the patient
// portal. Doctor-side page — anonymous visitors go to /login, accounts
// with no doctor profile to act as to the profile chooser; a patient
// that is not the acting doctor's is a plain 404.
export const Route = createPluginFileRoute("patient-access.routes")("/patient-access/$patientId")({
	beforeLoad: async () => {
		const access = await doctorAccessFn();
		if (access === "anonymous") throw redirect({ to: "/login" });
		if (access === "no-doctor") throw redirect({ to: "/doctors/select" });
	},
	loader: async ({ params }) => {
		const [data, locale] = await Promise.all([
			patientLinksFn({ data: Number(params.patientId) }),
			localeFn(),
		]);
		if (!data) throw notFound();
		return { ...data, locale };
	},
	component: function PatientAccessRoute() {
		const { patient, links, locale } = Route.useLoaderData();
		const router = useRouter();
		const api: PatientAccessApi = {
			invite: (input) => invitePatientFn({ data: { patientId: patient.id, ...input } }),
			approve: (id) => approvePatientLinkFn({ data: id }),
			revoke: (id) => revokePatientLinkFn({ data: id }),
		};
		return (
			<PatientAccessPage
				patient={patient}
				links={links}
				locale={locale}
				api={api}
				onChanged={() => void router.invalidate()}
			/>
		);
	},
});

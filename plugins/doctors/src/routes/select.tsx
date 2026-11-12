import { redirect } from "@tanstack/react-router";

import { createPluginFileRoute } from "@ktb/server-fns";

import { DoctorSelectPage, type DoctorSelectApi } from "../views/index.ts";
import { doctorContextFn, localeFn, selectDoctorFn } from "../fns.ts";

const api: DoctorSelectApi = {
	select: (doctorId) => selectDoctorFn({ data: doctorId }),
};

// Doctor profile chooser: where a signed-in user picks whose data they
// act on (their own profile or a doctor they are secretary of). An
// account with no doctor profile is a patient account — it has nothing
// to choose here and is sent to the patient portal; doctor profiles are
// only created by the doctor sign-up.
export const Route = createPluginFileRoute("doctors.routes")("/doctors/select")({
	loader: async () => {
		const [context, locale] = await Promise.all([doctorContextFn(), localeFn()]);
		if (!context) throw redirect({ to: "/login" });
		// Owned by the patient-portal plugin — coupled by URL only.
		if (context.profiles.length === 0) throw redirect({ to: "/portal" });
		return { ...context, locale };
	},
	component: function DoctorSelectRoute() {
		const { profiles, activeDoctorId, locale } = Route.useLoaderData();
		return (
			<DoctorSelectPage
				profiles={profiles}
				activeDoctorId={activeDoctorId}
				locale={locale}
				api={api}
				// Full reload: every loader re-runs under the new profile.
				onDone={() => window.location.assign("/")}
			/>
		);
	},
});

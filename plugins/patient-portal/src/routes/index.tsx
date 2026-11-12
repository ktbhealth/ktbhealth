import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { PortalPage, type PortalApi } from "../views/index.ts";
import { localeFn, portalFn, selectPatientFn, setCpfFn } from "../fns.ts";

const api: PortalApi = {
	select: (patientId) => selectPatientFn({ data: patientId }),
	setCpf: (cpf) => setCpfFn({ data: cpf }),
};

// Patient portal home: the consultations of the signed-in person's own
// record and of the ones in their care (e.g. a parent's children),
// read-only. Anonymous visitors go to the patient sign-in page.
export const Route = createFileRoute("/portal/")({
	loader: async () => {
		const [portal, locale] = await Promise.all([portalFn(), localeFn()]);
		if (!portal) throw redirect({ to: "/portal/login" });
		return { ...portal, locale };
	},
	component: function PortalRoute() {
		const { user, hasCpf, profiles, profile, consultations, locale } = Route.useLoaderData();
		const router = useRouter();
		return (
			<PortalPage
				user={user}
				hasCpf={hasCpf}
				profiles={profiles}
				profile={profile}
				consultations={consultations}
				locale={locale}
				api={api}
				onChanged={() => void router.invalidate()}
			/>
		);
	},
});

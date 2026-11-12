import { createFileRoute, notFound } from "@tanstack/react-router";

import { ConsultationDetailPage } from "../views/index.ts";
import { getConsultationFn, localeFn, patientHistoryFn } from "../fns.ts";
import { requireDoctor } from "../guard.ts";
import { consultationDetailApi } from "../apis.ts";

export const Route = createFileRoute("/consultations/$id")({
	staleTime: 30_000,
	beforeLoad: () => requireDoctor(),
	loader: async ({ params }) => {
		const c = await getConsultationFn({ data: Number(params.id) });
		if (!c) throw notFound();
		// Linked patient → factual summary of prior consultations (the
		// current one excluded). Null patient/history → unchanged UI.
		const history = c.patientId
			? await patientHistoryFn({ data: { patientId: c.patientId, excludeId: c.id } })
			: null;
		const locale = await localeFn();
		return { c, history, locale };
	},
	component: function ConsultationRoute() {
		const { c, history, locale } = Route.useLoaderData();
		return (
			<ConsultationDetailPage c={c} history={history} api={consultationDetailApi} locale={locale} />
		);
	},
});

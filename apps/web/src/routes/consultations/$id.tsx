import { createFileRoute, notFound } from "@tanstack/react-router";

import { ConsultationDetailPage, type ConsultationDetailApi } from "@ktb/consultations/views";
import { getConsultationFn, patientHistoryFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";

/** Live refetch for the audio-pipeline status poll (P-018). */
const consultationDetailApi: ConsultationDetailApi = {
	getConsultation: (input: { data: number }) => getConsultationFn(input),
};

export const Route = createFileRoute("/consultations/$id")({
	staleTime: 30_000,
	beforeLoad: () => requireSession(),
	loader: async ({ params }) => {
		const c = await getConsultationFn({ data: Number(params.id) });
		if (!c) throw notFound();
		// Linked patient → factual summary of prior consultations (the
		// current one excluded). Null patient/history → unchanged UI.
		const history = c.patientId
			? await patientHistoryFn({ data: { patientId: c.patientId, excludeId: c.id } })
			: null;
		return { c, history };
	},
	component: function ConsultationRoute() {
		const { c, history } = Route.useLoaderData();
		return <ConsultationDetailPage c={c} history={history} api={consultationDetailApi} />;
	},
});

import { createFileRoute, notFound } from "@tanstack/react-router";

import { ConsultaDetailPage } from "@ktb/consultations/views";
import { getConsultationFn } from "#/lib/fns.ts";

export const Route = createFileRoute("/consultas/$id")({
	loader: async ({ params }) => {
		const c = await getConsultationFn({ data: Number(params.id) });
		if (!c) throw notFound();
		return c;
	},
	component: function ConsultaRoute() {
		const c = Route.useLoaderData();
		return <ConsultaDetailPage c={c} />;
	},
});

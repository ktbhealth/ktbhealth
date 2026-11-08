import { createFileRoute } from "@tanstack/react-router";

import { ConsultationsPage } from "@ktb/consultations/views";
import { listConsultationsFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";

export const Route = createFileRoute("/consultations/")({
	staleTime: 30_000,
	beforeLoad: () => requireSession(),
	loader: () => listConsultationsFn(),
	component: function ConsultationsRoute() {
		const consultations = Route.useLoaderData();
		return <ConsultationsPage consultations={consultations} />;
	},
});

import { createFileRoute } from "@tanstack/react-router";

import { ConsultasPage } from "@ktb/consultations/views";
import { listConsultationsFn } from "#/lib/fns.ts";

export const Route = createFileRoute("/consultas/")({
	loader: () => listConsultationsFn(),
	component: function ConsultasRoute() {
		const consultas = Route.useLoaderData();
		return <ConsultasPage consultas={consultas} />;
	},
});

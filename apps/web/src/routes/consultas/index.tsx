import { createFileRoute } from "@tanstack/react-router";

import { ConsultasPage } from "@ktb/consultations/views";
import { listConsultationsFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";

export const Route = createFileRoute("/consultas/")({
	staleTime: 30_000,
	beforeLoad: () => requireSession(),
	loader: () => listConsultationsFn(),
	component: function ConsultasRoute() {
		const consultas = Route.useLoaderData();
		return <ConsultasPage consultas={consultas} />;
	},
});

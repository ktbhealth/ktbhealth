import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { ConsultationsPage } from "../views/index.ts";
import { listConsultationsFn } from "../fns.ts";
import { requireSession } from "../guard.ts";
import { prefetchWhisperModel } from "../whisper-prefetch.ts";

export const Route = createFileRoute("/consultations/")({
	staleTime: 30_000,
	beforeLoad: () => requireSession(),
	loader: () => listConsultationsFn(),
	component: function ConsultationsRoute() {
		const consultations = Route.useLoaderData();
		useEffect(() => prefetchWhisperModel(), []);
		return <ConsultationsPage consultations={consultations} />;
	},
});

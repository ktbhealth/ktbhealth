import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { ConsultationsPage } from "../views/index.ts";
import { listConsultationsFn, localeFn } from "../fns.ts";
import { requireSession } from "../guard.ts";
import { prefetchWhisperModel } from "../whisper-prefetch.ts";

export const Route = createFileRoute("/consultations/")({
	staleTime: 30_000,
	beforeLoad: () => requireSession(),
	loader: async () => {
		const [consultations, locale] = await Promise.all([listConsultationsFn(), localeFn()]);
		return { consultations, locale };
	},
	component: function ConsultationsRoute() {
		const { consultations, locale } = Route.useLoaderData();
		useEffect(() => prefetchWhisperModel(), []);
		return <ConsultationsPage consultations={consultations} locale={locale} />;
	},
});

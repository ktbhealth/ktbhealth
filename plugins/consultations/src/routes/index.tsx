import { useEffect } from "react";

import { createPluginFileRoute } from "@ktb/server-fns";

import { ConsultationsPage } from "../views/index.ts";
import { prefersWhisper } from "../backend.ts";
import { listConsultationsFn, localeFn } from "../fns.ts";
import { requireDoctor } from "../guard.ts";
import { prefetchWhisperModel } from "../whisper-prefetch.ts";

export const Route = createPluginFileRoute("consultations.routes")("/consultations/")({
	staleTime: 30_000,
	beforeLoad: () => requireDoctor(),
	loader: async () => {
		const [consultations, locale] = await Promise.all([listConsultationsFn(), localeFn()]);
		return { consultations, locale };
	},
	component: function ConsultationsRoute() {
		const { consultations, locale } = Route.useLoaderData();
		useEffect(() => {
			if (prefersWhisper) prefetchWhisperModel();
		}, []);
		return <ConsultationsPage consultations={consultations} locale={locale} />;
	},
});

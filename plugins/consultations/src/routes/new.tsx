import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { NewConsultationPage } from "../views/index.ts";
import { prefersWhisper, transcriptionBackend } from "../backend.ts";
import {
	newConsultationApi,
	newConsultationLoader,
	validateNewConsultationSearch,
} from "../apis.ts";
import { localeFn } from "../fns.ts";
import { requireSession } from "../guard.ts";
import { prefetchWhisperModel } from "../whisper-prefetch.ts";

export const Route = createFileRoute("/consultations/new")({
	validateSearch: validateNewConsultationSearch,
	beforeLoad: () => requireSession(),
	loader: async () => {
		const [initialPatients, locale] = await Promise.all([newConsultationLoader(), localeFn()]);
		return { initialPatients, locale };
	},
	component: function NewRoute() {
		const { initialPatients, locale } = Route.useLoaderData();
		const { patientId } = Route.useSearch();
		// Only warm the Whisper model when Whisper actually won resolution —
		// on the Web Speech fallback there is no model to prefetch.
		useEffect(() => {
			if (prefersWhisper) prefetchWhisperModel();
		}, []);
		return (
			<NewConsultationPage
				initialPatients={initialPatients}
				initialPatientId={patientId}
				api={newConsultationApi}
				backend={transcriptionBackend}
				locale={locale}
			/>
		);
	},
});

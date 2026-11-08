import { createFileRoute } from "@tanstack/react-router";

import { NewConsultationPage, type NewConsultationApi } from "@ktb/consultations/views";
import { whisperBackend } from "@ktb/transcription-whisper";
import {
	attachAnamnesisFn,
	createPatientFn,
	extractAnamnesisFn,
	getLiveConsultationFn,
	listPatientsFn,
	recordConsentFn,
	saveConsultationFn,
} from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";

export const newConsultationApi: NewConsultationApi = {
	getLiveConsultation: (input: { data: number }) => getLiveConsultationFn(input),
	extractAnamnesis: (input: { data: { transcript: string; patientId?: number } }) =>
		extractAnamnesisFn(input),
	attachAnamnesis: (input: { data: unknown }) => attachAnamnesisFn(input as never),
	saveConsultation: (input: { data: unknown }) => saveConsultationFn(input as never),
	recordConsent: (input: { data: number }) => recordConsentFn(input),
	createPatient: (input: { data: string }) => createPatientFn(input),
};

export const Route = createFileRoute("/consultations/new")({
	beforeLoad: () => requireSession(),
	loader: () => listPatientsFn(),
	component: function NewRoute() {
		const initialPatients = Route.useLoaderData();
		return (
			<NewConsultationPage
				initialPatients={initialPatients}
				api={newConsultationApi}
				backend={whisperBackend}
			/>
		);
	},
});

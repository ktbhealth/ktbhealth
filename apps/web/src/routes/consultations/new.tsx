import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { NewConsultationPage, type NewConsultationApi } from "@ktb/consultations/views";
import { whisperBackend } from "@ktb/transcription-whisper";
import {
	attachAnamnesisFn,
	createPatientFn,
	extractAnamnesisFn,
	getConsultationFn,
	getLiveConsultationFn,
	listPatientsFn,
	recordConsentFn,
	saveConsultationFn,
} from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";
import { prefetchWhisperModel } from "#/lib/whisper-prefetch.ts";

export const newConsultationApi: NewConsultationApi = {
	getLiveConsultation: (input: { data: number }) => getLiveConsultationFn(input),
	extractAnamnesis: (input: { data: { transcript: string; patientId?: number } }) =>
		extractAnamnesisFn(input),
	attachAnamnesis: (input: { data: unknown }) => attachAnamnesisFn(input as never),
	saveConsultation: (input: { data: unknown }) => saveConsultationFn(input as never),
	recordConsent: (input: { data: number }) => recordConsentFn(input),
	createPatient: (input: { data: { name: string; birthDate: string } }) => createPatientFn(input),
	getConsultation: (input: { data: number }) => getConsultationFn(input),
};

/** `?patientId=` preselects the patient ("New consultation" from the record page). */
export const validateNewConsultationSearch = (search: Record<string, unknown>) => {
	const id = Number(search.patientId);
	return Number.isInteger(id) && id > 0 ? { patientId: id } : {};
};

export const Route = createFileRoute("/consultations/new")({
	validateSearch: validateNewConsultationSearch,
	beforeLoad: () => requireSession(),
	loader: () => listPatientsFn(),
	component: function NewRoute() {
		const initialPatients = Route.useLoaderData();
		const { patientId } = Route.useSearch();
		useEffect(() => prefetchWhisperModel(), []);
		return (
			<NewConsultationPage
				initialPatients={initialPatients}
				initialPatientId={patientId}
				api={newConsultationApi}
				backend={whisperBackend}
			/>
		);
	},
});

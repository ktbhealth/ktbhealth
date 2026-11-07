import { createFileRoute } from "@tanstack/react-router";

import { NovaConsultaPage, type NovaApi } from "@ktb/consultations/views";
import { whisperBackend } from "@ktb/transcription-whisper";
import {
	attachAnamnesisFn,
	createPatientFn,
	extractAnamneseFn,
	getLiveConsultationFn,
	listPatientsFn,
	recordConsentFn,
	reviewAnamneseFn,
	saveConsultationFn,
} from "#/lib/fns.ts";

export const novaApi: NovaApi = {
	getLiveConsultation: (input: { data: number }) => getLiveConsultationFn(input),
	extractAnamnese: (input: { data: string }) => extractAnamneseFn(input),
	reviewAnamnese: (input: { data: unknown }) => reviewAnamneseFn(input as never),
	attachAnamnesis: (input: { data: unknown }) => attachAnamnesisFn(input as never),
	saveConsultation: (input: { data: unknown }) => saveConsultationFn(input as never),
	recordConsent: (input: { data: number }) => recordConsentFn(input),
	createPatient: (input: { data: string }) => createPatientFn(input),
};

export const Route = createFileRoute("/consulta/nova")({
	loader: () => listPatientsFn(),
	component: function NovaRoute() {
		const initialPatients = Route.useLoaderData();
		return (
			<NovaConsultaPage initialPatients={initialPatients} api={novaApi} backend={whisperBackend} />
		);
	},
});

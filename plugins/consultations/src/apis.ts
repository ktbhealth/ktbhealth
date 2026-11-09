import type { ConsultationDetailApi, NewConsultationApi } from "./views/index.ts";
import { createPatientFn, listPatientsFn } from "@ktb/patients/fns";
import {
	attachAnamnesisFn,
	extractAnamnesisFn,
	getConsultationFn,
	getLiveConsultationFn,
	recordConsentFn,
	saveConsultationFn,
} from "./fns.ts";

/**
 * View-facing API adapters for the consultations route modules: the
 * views speak small interfaces; these bind them to this plugin's server
 * fns (patient fns come from the patients plugin — same runtime
 * registry). Kept in one module so the wiring is testable without a
 * router.
 */
export const consultationDetailApi: ConsultationDetailApi = {
	getConsultation: (input: { data: number }) => getConsultationFn(input),
};

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

/** Loader data for /consultations/new — the patient picker list. */
export const newConsultationLoader = () => listPatientsFn();

/** `?patientId=` preselects the patient ("New consultation" from the record page). */
export const validateNewConsultationSearch = (search: Record<string, unknown>) => {
	const id = Number(search.patientId);
	return Number.isInteger(id) && id > 0 ? { patientId: id } : {};
};

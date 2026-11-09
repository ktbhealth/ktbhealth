import type { PatientDeleteApi, PatientFormApi } from "./views/index.ts";
import {
	createPatientFn,
	deletePatientFn,
	patientDeletionImpactFn,
	updatePatientFn,
} from "./fns.ts";

/**
 * View-facing API adapters for the patients route modules (P-033): the
 * views speak small interfaces; these bind them to this plugin's server
 * fns. Kept in one module so the wiring is testable without a router.
 */
export const newPatientApi: PatientFormApi = {
	save: (draft) => createPatientFn({ data: draft }),
};

export const editPatientApi = (id: number): PatientFormApi => ({
	save: (draft) => updatePatientFn({ data: { ...draft, id } }),
});

/** Patient deletion (impact preview + cascade) wired to the server fns. */
export const patientDeleteApi: PatientDeleteApi = {
	impact: (id) => patientDeletionImpactFn({ data: id }),
	remove: (id) => deletePatientFn({ data: id }),
};

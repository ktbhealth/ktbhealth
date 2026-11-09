import type { PatientDeleteApi } from "@ktb/patients/views";
import { deletePatientFn, patientDeletionImpactFn } from "#/lib/fns.ts";

/** Patient deletion (impact preview + cascade) wired to the server fns. */
export const patientDeleteApi: PatientDeleteApi = {
	impact: (id) => patientDeletionImpactFn({ data: id }),
	remove: (id) => deletePatientFn({ data: id }),
};

import type { AdminPatientRow } from "./index.ts";
import { AdminPatientsPage } from "./views/AdminPatientsPage.tsx";

/**
 * `panel.pages` component for /platform/patients (P-050): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props so the page contract stays a
 * single `{ data }` (the admin gate already ran in the layout's
 * beforeLoad and inside `Patients.adminList`).
 */
export function PatientsPlatformPage({ data }: { data: unknown }) {
	return <AdminPatientsPage patients={data as AdminPatientRow[]} />;
}

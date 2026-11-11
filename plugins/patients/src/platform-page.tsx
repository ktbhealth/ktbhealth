import type { PanelPageContext } from "@ktb/kernel";
import type { AdminPatientRow, OwnerOption } from "./index.ts";
import { AdminPatientsPage } from "./views/AdminPatientsPage.tsx";

export interface AdminPatientsData {
	patients: AdminPatientRow[];
	owners: OwnerOption[];
}

/**
 * `panel.pages` component for /platform/patients (P-050): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props so the page contract stays a
 * single `{ data }` (the admin gate already ran in the layout's
 * beforeLoad and inside `Patients.adminList`). `ctx.locale` feeds the
 * view's catalog.
 */
export function PatientsPlatformPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const { patients, owners } = data as AdminPatientsData;
	return <AdminPatientsPage patients={patients} owners={owners} locale={ctx.locale} />;
}

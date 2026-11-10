import type { PanelPageContext } from "@ktb/kernel";
import type { AdminPatientRow } from "./index.ts";
import { AdminPatientsPage } from "./views/AdminPatientsPage.tsx";

/**
 * `panel.pages` component for /platform/patients (P-050): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props so the page contract stays a
 * single `{ data }` (the admin gate already ran in the layout's
 * beforeLoad and inside `Patients.adminList`). `ctx.locale` feeds the
 * view's catalog.
 */
export function PatientsPlatformPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const patients = data as AdminPatientRow[];
	return <AdminPatientsPage patients={patients} locale={ctx.locale} />;
}

import type { AdminConsultationRow } from "./index.ts";
import { AdminConsultationsPage } from "./views/AdminConsultationsPage.tsx";

/**
 * `panel.pages` component for /platform/consultations (P-050): the
 * host dispatcher hands the loader Effect's result as `data`; this
 * wrapper narrows it back into the view's props (the admin gate
 * already ran in the layout's beforeLoad and inside
 * `Consultations.adminList`).
 */
export function ConsultationsPlatformPage({ data }: { data: unknown }) {
	const consultations = data as AdminConsultationRow[];
	return <AdminConsultationsPage consultations={consultations} />;
}

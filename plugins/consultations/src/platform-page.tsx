import type { AdminConsultationRow } from "./index.ts";
import type { OwnerOption } from "@ktb/patients";
import type { PanelPageContext } from "@ktb/kernel";
import { AdminConsultationsPage } from "./views/AdminConsultationsPage.tsx";

/** Patient picker option for the admin create form. */
export interface ConsultationPatientOption {
	readonly id: number;
	readonly name: string;
	readonly ownerId: string;
	readonly ownerName: string;
}

interface AdminConsultationsData {
	consultations: AdminConsultationRow[];
	owners: OwnerOption[];
	patients: ConsultationPatientOption[];
}

/**
 * `panel.pages` component for /platform/consultations (P-050): the
 * host dispatcher hands the loader Effect's result as `data`; this
 * wrapper narrows it back into the view's props (the admin gate
 * already ran in the layout's beforeLoad and inside
 * `Consultations.adminList`). `ctx.locale` feeds the view's catalog.
 */
export function ConsultationsPlatformPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const { consultations, owners, patients } = data as AdminConsultationsData;
	return (
		<AdminConsultationsPage
			consultations={consultations}
			owners={owners}
			patients={patients}
			locale={ctx.locale}
		/>
	);
}

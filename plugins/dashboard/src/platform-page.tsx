import type { PanelPageContext } from "@ktb/kernel";
import type { AdminConsultationRow } from "@ktb/consultations";
import type { ConsoleNotification } from "@ktb/notifications/context";
import type { AdminPatientRow } from "@ktb/patients";

import { DashboardPage } from "./views/DashboardPage.tsx";

interface DashboardData {
	readonly patients: AdminPatientRow[];
	readonly consultations: AdminConsultationRow[];
	readonly notifications?: readonly ConsoleNotification[];
	readonly unreadCount?: number;
}

/**
 * `panel.pages` component for /platform (P-050): the host dispatcher
 * hands the loader Effect's result as `data` and the discovered plugin
 * registry as `ctx.plugins` — the dashboard's plugin-cards section
 * needs it and plugins cannot import the app host themselves.
 */
export function DashboardPlatformPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const d = data as DashboardData;
	return (
		<DashboardPage
			patients={d.patients}
			consultations={d.consultations}
			plugins={ctx.plugins}
			notifications={d.notifications}
			unreadCount={d.unreadCount}
		/>
	);
}

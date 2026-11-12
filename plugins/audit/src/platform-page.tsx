import type { PanelPageContext } from "@ktb/kernel";

import type { AuditListResult } from "./index.ts";
import { AuditPage } from "./views/AuditPage.tsx";

const EMPTY: AuditListResult = { entries: [], total: 0, limit: 200 };

/**
 * `panel.pages` component for /platform/audit (T-037): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props (the admin gate already ran in
 * the page `guard` and inside `Audit.adminList`). `ctx.locale` feeds
 * the view's catalog.
 */
export function AuditPlatformPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const d = (data ?? {}) as Partial<AuditListResult>;
	return (
		<AuditPage
			entries={Array.isArray(d.entries) ? d.entries : EMPTY.entries}
			total={typeof d.total === "number" ? d.total : 0}
			locale={ctx.locale}
		/>
	);
}

import type { PanelPageContext } from "@ktb/kernel";

import type { AdminRbacPageData } from "./index.ts";
import { AdminRbacPage } from "./views/AdminRbacPage.tsx";

/**
 * `panel.pages` component for /platform/roles (P-054/P-050): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props (the admin gate already ran in
 * the layout's beforeLoad and inside every `rbac.*` query/command).
 * `ctx.locale` feeds the view's catalog.
 */
export function RbacPlatformPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const pageData = (data ?? {
		roles: [],
		details: [],
		assignments: [],
		catalog: [],
	}) as AdminRbacPageData;
	return <AdminRbacPage data={pageData} locale={ctx.locale} />;
}

import type { PanelPageContext } from "@ktb/kernel";
import type { TenantRow } from "./index.ts";
import { AdminTenantsPage } from "./views/AdminTenantsPage.tsx";

/**
 * `panel.pages` component for /platform/tenants (P-053): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props (the admin gate already ran in
 * the layout's beforeLoad and inside `Tenants.list`). `ctx.locale`
 * feeds the view's catalog.
 */
export function TenantsPlatformPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const tenants = Array.isArray(data) ? (data as TenantRow[]) : [];
	return <AdminTenantsPage tenants={tenants} locale={ctx.locale} />;
}

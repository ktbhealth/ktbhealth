import type { PanelPageContext } from "@ktb/kernel";

import type { AdminPageRow, PagesAdminPageProps } from "./views/PagesAdminPage.tsx";
import { PagesAdminPage } from "./views/PagesAdminPage.tsx";

const asRows = (data: unknown): readonly AdminPageRow[] =>
	Array.isArray(data)
		? data.filter(
				(row): row is AdminPageRow =>
					typeof row === "object" &&
					row !== null &&
					typeof (row as AdminPageRow).id === "number" &&
					typeof (row as AdminPageRow).path === "string",
			)
		: [];

/**
 * `panel.pages` component for /platform/pages (T-083): the host
 * dispatcher hands the loader Effect's result (every `custom_pages`
 * row, drafts included) as `data`; this wrapper narrows it into the
 * view's props. The admin gate already ran in the page `guard` and
 * inside every `CustomPages.admin*` method.
 */
export function PagesAdminConsolePage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const props: PagesAdminPageProps = { pages: asRows(data), locale: ctx.locale };
	return <PagesAdminPage {...props} />;
}

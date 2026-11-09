import type { AdminGroupRow } from "./index.ts";
import { AdminGroupsPage } from "./views/AdminGroupsPage.tsx";

/**
 * `panel.pages` component for /platform/groups (P-050): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props (the admin gate already ran in
 * the layout's beforeLoad and inside `Groups.list`).
 */
export function GroupsPlatformPage({ data }: { data: unknown }) {
	const groups = data as AdminGroupRow[];
	return <AdminGroupsPage groups={groups} />;
}

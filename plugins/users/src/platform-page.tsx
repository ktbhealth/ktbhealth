import type { AdminUserRow } from "./index.ts";
import { AdminUsersPage } from "./views/AdminUsersPage.tsx";

/**
 * `panel.pages` component for /platform/users (P-050): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props (the admin gate already ran in
 * the layout's beforeLoad and inside `Users.adminList`).
 */
export function UsersPlatformPage({ data }: { data: unknown }) {
	const users = data as AdminUserRow[];
	return <AdminUsersPage users={users} />;
}

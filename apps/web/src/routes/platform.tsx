import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";

import { platformAdminFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";
import { plugins } from "#/plugins.ts";

// /platform console shell (P-031): dense sidebar aggregating every
// plugin's `panel.sidebar` contribution in topo order. The admin gate
// is server-side — non-admins get a hard 404, never just hidden nav.
export const Route = createFileRoute("/platform")({
	beforeLoad: async () => {
		await requireSession();
		if (!(await platformAdminFn())) throw notFound();
	},
	component: PlatformLayout,
});

const NAV_LINK =
	"block rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground";
const NAV_ACTIVE = "bg-muted font-medium text-foreground";

function PlatformLayout() {
	const items = plugins.flatMap((p) => p.panel?.sidebar ?? []);
	return (
		<div className="flex gap-8">
			<aside className="w-44 shrink-0">
				<div className="px-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Platform
				</div>
				<nav className="mt-2 space-y-0.5" aria-label="Platform">
					{items.map((item) => (
						<Link
							key={item.to}
							to={item.to}
							className={NAV_LINK}
							activeProps={{ className: `${NAV_LINK} ${NAV_ACTIVE}` }}
							activeOptions={{ exact: item.to === "/platform" }}
						>
							{item.label}
						</Link>
					))}
				</nav>
			</aside>
			<div className="min-w-0 flex-1">
				<Outlet />
			</div>
		</div>
	);
}

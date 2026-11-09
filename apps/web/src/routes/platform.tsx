import { createFileRoute, Link, notFound, Outlet, useLocation } from "@tanstack/react-router";

import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@ktbhealth/ui/components/sidebar";
import type { PanelSidebarItem } from "@ktb/kernel";

import { platformAdminFn } from "#/lib/fns.ts";
import { requireSession } from "#/lib/guard.ts";
import { plugins } from "#/plugins.ts";

// /platform console shell (P-031): shadcn sidebar aggregating every
// plugin's `panel.sidebar` contribution in topo order. The admin gate
// is server-side — non-admins get a hard 404, never just hidden nav.
export const Route = createFileRoute("/platform")({
	beforeLoad: async () => {
		await requireSession();
		if (!(await platformAdminFn())) throw notFound();
	},
	component: PlatformLayout,
});

const isItemActive = (pathname: string, item: PanelSidebarItem) =>
	item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

function PlatformLayout() {
	const pathname = useLocation({ select: (l) => l.pathname });
	const items = plugins.flatMap((p) => p.panel?.sidebar ?? []);
	return (
		<SidebarProvider>
			<Sidebar collapsible="none">
				<SidebarHeader>
					<div className="px-2 pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Platform
					</div>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>Console</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{items.map((item) => (
									<SidebarMenuItem key={item.to}>
										<SidebarMenuButton
											render={<Link to={item.to} />}
											isActive={isItemActive(pathname, item)}
										>
											{item.icon ? <item.icon /> : null}
											<span>{item.label}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
			<div className="min-w-0 flex-1 p-2">
				<Outlet />
			</div>
		</SidebarProvider>
	);
}

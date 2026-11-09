import { createFileRoute, Link, notFound, Outlet, useLocation } from "@tanstack/react-router";
import { LogOutIcon, ArrowLeftIcon } from "lucide-react";

import { authClient } from "@ktb/auth-better/client";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
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
import { getRouteApi } from "@tanstack/react-router";

// /platform console shell (P-031): a system console, not an app page —
// the root route drops its marketing chrome on /platform* and this
// layout owns the full viewport: dark theme, fixed sidebar aggregating
// every plugin's `panel.sidebar` contribution in topo order, dense
// top bar. The admin gate is server-side — non-admins get a hard 404,
// never just hidden nav.
export const Route = createFileRoute("/platform")({
	beforeLoad: async () => {
		await requireSession();
		if (!(await platformAdminFn())) throw notFound();
	},
	component: PlatformLayout,
});

const rootApi = getRouteApi("__root__");

const isItemActive = (pathname: string, item: PanelSidebarItem) =>
	item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

function PlatformLayout() {
	const pathname = useLocation({ select: (l) => l.pathname });
	const user = rootApi.useLoaderData();
	const items = plugins.flatMap((p) => p.panel?.sidebar ?? []);
	const current = items.find((i) => isItemActive(pathname, i));
	return (
		<SidebarProvider className="dark h-dvh min-h-0">
			<Sidebar collapsible="none" className="border-sidebar-border border-r">
				<SidebarHeader>
					<div className="flex items-center gap-2 px-2 pt-1">
						<span className="font-mono text-sm font-bold tracking-tight">KTB</span>
						<span className="rounded border border-sidebar-border px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
							PLATFORM
						</span>
					</div>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel className="font-mono text-[10px] tracking-widest uppercase">
							Console
						</SidebarGroupLabel>
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
				<SidebarFooter>
					<div className="flex items-center justify-between gap-2 px-2 pb-1">
						<span className="truncate font-mono text-[11px] text-muted-foreground">
							{user?.email ?? "admin"}
						</span>
						<button
							type="button"
							className="rounded p-1 text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							title="Sign out"
							onClick={async () => {
								await authClient.signOut();
								window.location.assign("/");
							}}
						>
							<LogOutIcon className="size-3.5" />
						</button>
					</div>
				</SidebarFooter>
			</Sidebar>
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
					<nav className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
						<span>platform</span>
						<span>/</span>
						<span className="text-foreground">{current?.label ?? "overview"}</span>
					</nav>
					<div className="ml-auto">
						<Link
							to="/"
							className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
						>
							<ArrowLeftIcon className="size-3" />
							back to app
						</Link>
					</div>
				</header>
				<main className="min-h-0 flex-1 overflow-auto p-4">
					<Outlet />
				</main>
			</div>
		</SidebarProvider>
	);
}

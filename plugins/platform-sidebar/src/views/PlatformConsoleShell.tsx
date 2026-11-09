import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, LogOutIcon } from "lucide-react";

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@ktbhealth/ui/components/breadcrumb";
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

export interface PlatformConsoleShellProps {
	/** Aggregated `panel.sidebar` items from every plugin, in topo order. */
	readonly items: readonly PanelSidebarItem[];
	readonly pathname: string;
	readonly userEmail?: string;
	/**
	 * Optional right-side header widgets contributed by plugins via
	 * `panel.headerActions` — rendered only when the host enables the
	 * `platform.header` extension point.
	 */
	readonly headerActions?: ReactNode;
	/** Injected by the host — plugins cannot import the auth client. */
	readonly onSignOut: () => void | Promise<void>;
	readonly children?: ReactNode;
}

const isItemActive = (pathname: string, item: PanelSidebarItem) =>
	item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

/**
 * /platform console chrome: fixed sidebar aggregating every plugin's
 * `panel.sidebar` contribution in topo order (grouped by `group`,
 * ungrouped pinned first), dense breadcrumb top bar, sign-out footer.
 * Purely presentational — the host route owns the admin guard and
 * injects items/pathname/user/sign-out.
 */
export function PlatformConsoleShell({
	items,
	pathname,
	userEmail,
	headerActions,
	onSignOut,
	children,
}: PlatformConsoleShellProps) {
	// Group sidebar items by their `group` label, preserving the
	// flattened topo order — groups order by first appearance, with the
	// ungrouped section pinned to the top.
	const groups = new Map<string, PanelSidebarItem[]>();
	for (const item of items) {
		const key = item.group ?? "";
		const list = groups.get(key) ?? [];
		list.push(item);
		groups.set(key, list);
	}
	const orderedGroups = [...groups.entries()].sort(
		([a], [b]) => Number(a !== "") - Number(b !== ""),
	);
	const current = items.find((i) => isItemActive(pathname, i));
	// Breadcrumb leaf: the matched sidebar item's label (the plugin
	// provides it via panel.sidebar), else the last path segment.
	const leaf =
		pathname === "/platform"
			? "overview"
			: (current?.label ?? pathname.split("/").filter(Boolean).at(-1) ?? "overview");
	return (
		<SidebarProvider className="h-dvh min-h-0">
			<Sidebar collapsible="none" className="border-sidebar-border border-r">
				<SidebarHeader>
					<div className="flex items-center gap-2 px-2 pt-1">
						<span className="text-sm font-bold tracking-tight">KTB</span>
						<span className="rounded border border-sidebar-border px-1 py-0.5 text-[10px] text-muted-foreground">
							PLATFORM
						</span>
					</div>
				</SidebarHeader>
				<SidebarContent>
					{orderedGroups.map(([name, groupItems]) => (
						<SidebarGroup key={name || "__default__"}>
							{name ? (
								<SidebarGroupLabel className="text-[10px] tracking-widest uppercase">
									{name}
								</SidebarGroupLabel>
							) : null}
							<SidebarGroupContent>
								<SidebarMenu>
									{groupItems.map((item) => (
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
					))}
				</SidebarContent>
				<SidebarFooter>
					<div className="flex items-center justify-between gap-2 px-2 pb-1">
						<span className="truncate text-[11px] text-muted-foreground">
							{userEmail ?? "admin"}
						</span>
						<button
							type="button"
							className="rounded p-1 text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							title="Sign out"
							onClick={() => void onSignOut()}
						>
							<LogOutIcon className="size-3.5" />
						</button>
					</div>
				</SidebarFooter>
			</Sidebar>
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
					<Breadcrumb className="text-xs">
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink render={<Link to="/platform" />}>platform</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>{leaf}</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
					<div className="ml-auto flex items-center gap-2">
						{headerActions}
						<Link
							to="/"
							className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
						>
							<ArrowLeftIcon className="size-3" />
							back to app
						</Link>
					</div>
				</header>
				<main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
			</div>
		</SidebarProvider>
	);
}

import { LayoutDashboardIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { DashboardPlatformPage } from "./platform-page.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). The dashboard plugin is a single panel
 * contribution: sidebar entry plus the /platform page descriptor.
 * `panel.pages` keep id/path/component only — the loader Effect runs
 * server-side and stays in ./index.ts. Dep ids are literals: importing
 * ./index.ts would pull the server graph into the client bundle. Keep
 * in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const dashboardChromePlugin = definePlugin({
	id: "dashboard.chrome",
	requiredDeps: ["platform.panel"],
	chrome: [
		{
			id: "dashboard.sidebar",
			region: "console.sidebar",
			content: {
				kind: "sidebarItem",
				item: {
					to: "/platform",
					label: "Dashboard",
					icon: LayoutDashboardIcon,
					exact: true,
				},
			},
		},
	],
});

export const dashboardPanelPlugin = definePlugin({
	id: "dashboard.panel",
	requiredDeps: ["platform.panel", "patients.services", "consultations.services"],
	optionalDeps: ["notifications.services"],
	panel: {
		pages: [
			{
				id: "dashboard.home",
				path: "/platform",
				component: DashboardPlatformPage,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [dashboardChromePlugin, dashboardPanelPlugin];

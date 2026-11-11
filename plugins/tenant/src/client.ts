import { Building2Icon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { TenantsPlatformPage } from "./platform-page.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Every server entry keeps its id and dep
 * edges so topo order matches the server registry, but only
 * client-consumed contributions are carried: the panel sidebar entry
 * and page descriptor. `panel.pages` keep id/path/component only — the
 * loader Effect runs server-side and stays in ./index.ts.
 * services degrade to markers. Dep ids are literals: importing
 * ./index.ts would pull the server graph into the client bundle. Keep
 * in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const tenantChromePlugin = definePlugin({
	id: "tenant.chrome",
	requiredDeps: ["platform.panel"],
	chrome: [
		{
			id: "tenant.sidebar",
			region: "console.sidebar",
			content: {
				kind: "sidebarItem",
				item: { to: "/platform/tenants", label: "Tenants", icon: Building2Icon, group: "Access" },
			},
		},
	],
});

export const tenantPanelPlugin = definePlugin({
	id: "tenant.panel",
	requiredDeps: ["platform.panel"],
	panel: {
		pages: [
			{
				id: "tenant.admin",
				path: "/platform/tenants",
				component: TenantsPlatformPage,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	definePlugin({
		id: "tenant.services",
		// Mirrors tenantServicesPlugin.requiredDeps (server index.ts) —
		// literal id: importing @ktb/groups would pull the server graph
		// into the client bundle.
		requiredDeps: ["groups.services"],
	}),
	tenantChromePlugin,
	tenantPanelPlugin,
];

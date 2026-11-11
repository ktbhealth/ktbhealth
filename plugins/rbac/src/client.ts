import { ShieldCheckIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { RbacPlatformPage } from "./platform-page.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Every server entry keeps its id and dep
 * edges so topo order matches the server registry, but only
 * client-consumed contributions are carried: the console.sidebar chrome entry
 * and page descriptor. `panel.pages` keep id/path/component only — the
 * loader Effect runs server-side and stays in ./index.ts.
 * tables/services degrade to markers. Dep ids are literals: importing
 * ./index.ts would pull the server graph into the client bundle. Keep
 * in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const rbacChromePlugin = definePlugin({
	id: "rbac.chrome",
	requiredDeps: ["platform.panel"],
	chrome: [
		{
			id: "rbac.sidebar",
			region: "console.sidebar",
			content: {
				kind: "sidebarItem",
				item: { to: "/platform/roles", label: "Roles", icon: ShieldCheckIcon, group: "Access" },
			},
		},
	],
});

export const rbacPanelPlugin = definePlugin({
	id: "rbac.panel",
	requiredDeps: ["platform.panel"],
	panel: {
		pages: [
			{
				id: "rbac.admin",
				path: "/platform/roles",
				component: RbacPlatformPage,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	definePlugin({ id: "rbac.tables" }),
	definePlugin({
		id: "rbac.services",
		requiredDeps: ["platform.admin"],
		// Mirrors rbacServicesPlugin.optionalDeps (server index.ts).
		optionalDeps: ["audit.services"],
	}),
	rbacChromePlugin,
	rbacPanelPlugin,
];

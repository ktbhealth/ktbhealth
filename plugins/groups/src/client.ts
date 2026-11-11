import { BoxesIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { GroupsPlatformPage } from "./platform-page.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Every server entry keeps its id and dep
 * edges so topo order matches the server registry, but only
 * client-consumed contributions are carried: the panel sidebar entry
 * and page descriptor. `panel.pages` keep id/path/component only — the
 * loader Effect runs server-side and stays in ./index.ts.
 * tables/services degrade to markers. Dep ids are literals: importing
 * ./index.ts would pull the server graph into the client bundle. Keep
 * in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const groupsPanelPlugin = definePlugin({
	id: "groups.panel",
	requiredDeps: ["platform.panel"],
	panel: {
		sidebar: [{ to: "/platform/groups", label: "Groups", icon: BoxesIcon, group: "Access" }],
		pages: [
			{
				id: "groups.admin",
				path: "/platform/groups",
				component: GroupsPlatformPage,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	definePlugin({ id: "groups.tables" }),
	definePlugin({
		id: "groups.services",
		requiredDeps: ["platform.admin"],
		// Mirrors groupsServicesPlugin.optionalDeps (server index.ts) —
		// literal id: importing @ktb/rbac-plugin would pull the server
		// graph into the client bundle.
		optionalDeps: ["rbac.services", "audit.services"],
	}),
	groupsPanelPlugin,
];

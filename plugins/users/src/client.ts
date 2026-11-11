import { UserCogIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { UsersPlatformPage } from "./platform-page.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). The services entry degrades to a marker;
 * the panel entry keeps its sidebar item and page descriptor —
 * `panel.pages` keep id/path/component only, the loader Effect runs
 * server-side and stays in ./index.ts. Dep ids are literals: importing
 * ./index.ts would pull the server graph into the client bundle. Keep
 * in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const usersPanelPlugin = definePlugin({
	id: "users.panel",
	requiredDeps: ["platform.panel"],
	panel: {
		sidebar: [{ to: "/platform/users", label: "Users", icon: UserCogIcon, group: "Access" }],
		pages: [
			{
				id: "users.admin",
				path: "/platform/users",
				component: UsersPlatformPage,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	definePlugin({
		id: "users.services",
		requiredDeps: ["platform.admin"],
	}),
	usersPanelPlugin,
];

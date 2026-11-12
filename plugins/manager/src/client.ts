import { PuzzleIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { ManagerPage } from "./platform-page.tsx";
import { managerConfig } from "./config.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). `panel.pages` keeps
 * id/path/component only — the loader Effect stays server-side in
 * ./index.ts. Dep ids are literals: importing ./index.ts would pull the
 * server graph into the client bundle. Keep in sync — parity is asserted
 * by apps/web/src/plugins.test.ts.
 */
export const managerChromePlugin = definePlugin({
	id: "manager.chrome",
	system: true,
	requiredDeps: ["platform.panel"],
	meta: {
		name: "Plugin manager",
		description: "Runtime plugin enable/config administration",
		icon: PuzzleIcon,
	},
	chrome: [
		{
			id: "manager.sidebar",
			region: "console.sidebar",
			content: {
				kind: "sidebarItem",
				item: {
					to: "/platform/plugins",
					label: "Plugins",
					icon: PuzzleIcon,
					group: "System",
				},
			},
		},
	],
});

export const managerPanelPlugin = definePlugin({
	id: "manager.panel",
	system: true,
	requiredDeps: ["platform.panel"],
	meta: {
		name: "Plugin manager",
		description: "Runtime plugin enable/config administration",
		icon: PuzzleIcon,
		config: managerConfig,
	},
	panel: {
		pages: [
			{
				id: "manager.plugins",
				path: "/platform/plugins",
				component: ManagerPage,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [managerChromePlugin, managerPanelPlugin];

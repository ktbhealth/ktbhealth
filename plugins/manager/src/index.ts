import { PuzzleIcon } from "lucide-react";
import * as Effect from "effect/Effect";

import { definePlugin, type Plugin } from "@ktb/kernel";
import { PlatformAdmin, platformPanelPlugin } from "@ktb/platform";
import { PluginStates } from "@ktb/platform/plugin-states";

import { ManagerPage } from "./platform-page.tsx";
import { managerConfig, managerConfigSchema } from "./config.tsx";

/**
 * Plugin manager chrome (P-058): the /platform/plugins sidebar entry in
 * the console.chrome region, "System" group. Mirrors ./client.ts; parity
 * is asserted by apps/web/src/plugins.test.ts.
 */
export const managerChromePlugin = definePlugin({
	id: "manager.chrome",
	// The manager is the only UI that can re-enable plugins — disabling
	// it would strand the console, so both entries are system plugins.
	system: true,
	requiredDeps: [platformPanelPlugin.id],
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

/**
 * Plugin manager page (P-058): /platform/plugins lists every discovered
 * plugin — meta, contribution kinds, dep status, enabled state and
 * `meta.config` forms. The loader returns ONLY the state half
 * (PluginStates.entries); structure/meta/deps come from the client
 * registry via `ctx.plugins`, so this package never imports the host.
 * PlatformAdmin is re-checked inside the loader (defense in depth —
 * the /platform layout gate already ran).
 */
export const managerPanelPlugin = definePlugin({
	id: "manager.panel",
	system: true,
	requiredDeps: [platformPanelPlugin.id],
	meta: {
		name: "Plugin manager",
		description: "Runtime plugin enable/config administration",
		icon: PuzzleIcon,
		config: managerConfig,
	},
	// Server-only validation schema — the JSON doc on meta.config is its
	// projection; PluginStates decodes config JSON against this.
	configSchema: managerConfigSchema,
	panel: {
		pages: [
			{
				id: "manager.plugins",
				path: "/platform/plugins",
				component: ManagerPage,
				loader: () =>
					Effect.gen(function* () {
						const platformAdmin = yield* PlatformAdmin;
						yield* platformAdmin.requireAdmin();
						const states = yield* PluginStates;
						return { states: yield* states.entries() };
					}),
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [managerChromePlugin, managerPanelPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"manager.chrome": true;
		"manager.panel": true;
	}
}

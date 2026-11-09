import { definePlugin, type Plugin } from "@ktb/kernel";
import { platformPanelPlugin } from "@ktb/platform";
import { LayoutDashboardIcon } from "lucide-react";

// Panel (system console) contribution: the console landing page
// (/platform) is mounted by the platform plugin's physical route
// subtree; this plugin declares the sidebar entry that owns it. The
// dep edge orders it after the platform shell.
export const dashboardPanelPlugin = definePlugin({
	id: "dashboard.panel",
	requiredDeps: [platformPanelPlugin.id],
	panel: {
		sidebar: [
			{
				to: "/platform",
				label: "Dashboard",
				icon: LayoutDashboardIcon,
				exact: true,
				group: "General",
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [dashboardPanelPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"dashboard.panel": true;
	}
}

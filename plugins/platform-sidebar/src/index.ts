import { definePlugin, type Plugin } from "@ktb/kernel";
import { platformPanelPlugin } from "@ktb/platform";

/**
 * Marker plugin for the /platform console chrome. The sidebar shell
 * itself is a view (`@ktb/platform-sidebar/views` → PlatformConsoleShell)
 * bound by the host route — plugins cannot own route files or import
 * the auth client, so the host injects items/pathname/user/sign-out.
 * The dep edge orders it after the panel anchor; it contributes no
 * sidebar items of its own (feature `*.panel` plugins own those).
 */
export const platformSidebarPlugin = definePlugin({
	id: "platform.sidebar",
	requiredDeps: [platformPanelPlugin.id],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [platformSidebarPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"platform.sidebar": true;
	}
}

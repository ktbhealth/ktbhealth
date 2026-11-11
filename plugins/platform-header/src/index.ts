import { definePlugin, type Plugin } from "@ktb/kernel";
import { platformPanelPlugin } from "@ktb/platform";

/**
 * Marker plugin for the /platform console top-bar extension point.
 * Its presence enables `console.header.actions` chrome contributions (icon
 * buttons/popovers on the right side of the header) — the host only
 * aggregates them when this plugin is registered, so feature plugins
 * can offer header widgets (jobs, notifications…) that degrade
 * gracefully when the console chrome doesn't support them.
 */
export const platformHeaderPlugin = definePlugin({
	id: "platform.header",
	requiredDeps: [platformPanelPlugin.id],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [platformHeaderPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"platform.header": true;
	}
}

import { definePlugin, type Plugin } from "@ktb/kernel";
import { platformPanelPlugin } from "@ktb/platform";
import { platformHeaderPlugin } from "@ktb/platform-header";

import { NotificationsHeaderAction } from "./views/NotificationsHeaderAction.tsx";

/**
 * Console notifications: contributes a header action (bell icon +
 * unread badge + popover) to the /platform top bar. Like jobs, the
 * action only renders when the `platform.header` extension point is
 * present; notification data reaches the component through
 * NotificationsDataContext, which a host route provides once a
 * notifications backend exists.
 */
export const notificationsHeaderPlugin = definePlugin({
	id: "notifications.header",
	requiredDeps: [platformPanelPlugin.id],
	optionalDeps: [platformHeaderPlugin.id],
	panel: {
		headerActions: [{ id: "notifications", component: NotificationsHeaderAction }],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [notificationsHeaderPlugin];

export { NotificationsDataContext, type ConsoleNotification } from "./context.ts";

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"notifications.header": true;
	}
}

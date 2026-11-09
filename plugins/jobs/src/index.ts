import { ListTodoIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";
import { platformHeaderPlugin } from "@ktb/platform-header";
import { platformPanelPlugin } from "@ktb/platform";

import { JobsHeaderAction } from "./views/JobsHeaderAction.tsx";

/**
 * Console jobs feed: contributes a header action (icon button + wide
 * popover) to the /platform top bar. The action only renders when the
 * `platform.header` extension point is present — hence the optional dep
 * documenting the graceful-degradation contract. Job data reaches the
 * component through JobsDataContext, which the host route provides.
 */
export const jobsHeaderPlugin = definePlugin({
	id: "jobs.header",
	requiredDeps: [platformPanelPlugin.id],
	optionalDeps: [platformHeaderPlugin.id],
	panel: {
		headerActions: [{ id: "jobs", component: JobsHeaderAction }],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [jobsHeaderPlugin];

export { JobsDataContext, type ConsoleJob } from "./context.ts";
export { jobsFromAudioRows, type AudioJobRow } from "./jobs.ts";

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"jobs.header": true;
	}
}

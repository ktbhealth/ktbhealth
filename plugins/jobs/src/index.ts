import { ListTodoIcon } from "lucide-react";
import { physical } from "@tanstack/virtual-file-routes";

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

// Route subtree composed into the host's virtualRouteConfig (P-033):
// the SSE route module lives in THIS package (src/api-routes/**) and is
// discovered by a physical() directory scan mounted under the shared
// "/api" prefix, alongside the host's own api directory. The directory
// path is resolved relative to the host's routes directory
// (apps/web/src/routes) — "../../../../" escapes to the repo root —
// and the module reaches the app runtime through @ktb/server-fns (the
// Consultations service comes from @ktb/consultations), so the plugin
// owns the route end to end with zero host route files. Route modules
// must live directly in src/api-routes/ — the generator scans every
// .ts file there, so tests stay outside this directory.
export const jobsRoutesPlugin = definePlugin({
	id: "jobs.routes",
	routes: [physical("/api", "../../../../plugins/jobs/src/api-routes")],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [jobsHeaderPlugin, jobsRoutesPlugin];

export { JobsDataContext, type ConsoleJob } from "./context.ts";
export { jobFromAudioRow, jobsFromAudioRows, type AudioJobRow } from "./jobs.ts";

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"jobs.header": true;
		"jobs.routes": true;
	}
}

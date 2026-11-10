import { definePlugin, type Plugin } from "@ktb/kernel";

import { JobsHeaderAction } from "./views/JobsHeaderAction.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Both entries are already client-safe
 * (header action component + route subtree marker); the routes
 * contribution is only consumed by route typegen and degrades to a
 * marker here. Dep ids are literals: importing ./index.ts would pull
 * the server graph into the client bundle. Keep in sync — parity is
 * asserted by apps/web/src/plugins.test.ts.
 */
export const jobsHeaderPlugin = definePlugin({
	id: "jobs.header",
	requiredDeps: ["platform.panel"],
	optionalDeps: ["platform.header"],
	panel: {
		headerActions: [{ id: "jobs", component: JobsHeaderAction }],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [jobsHeaderPlugin, definePlugin({ id: "jobs.routes" })];

import { ActivityIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { OpsPlatformPage } from "./platform-page.tsx";
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

/**
 * Client mirror of opsServicesPlugin — services degrade to a marker;
 * requiredDeps stay literal (importing @ktb/consultations would pull
 * the server graph into the client bundle).
 */
export const opsServicesPlugin = definePlugin({
	id: "jobs.ops.services",
	requiredDeps: ["consultations.services", "platform.admin"],
});

/**
 * Client mirror of opsPanelPlugin — `panel.pages` keep id/path/component
 * only; the guard/loader Effects run server-side and stay in
 * ./index.ts.
 */
export const opsPanelPlugin = definePlugin({
	id: "jobs.panel",
	requiredDeps: ["platform.panel", "jobs.ops.services"],
	panel: {
		sidebar: [{ to: "/platform/ops", label: "Ops", icon: ActivityIcon, group: "System" }],
		pages: [{ id: "jobs.ops", path: "/platform/ops", component: OpsPlatformPage }],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	jobsHeaderPlugin,
	definePlugin({ id: "jobs.routes" }),
	opsServicesPlugin,
	opsPanelPlugin,
];

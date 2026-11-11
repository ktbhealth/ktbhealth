import { ActivityIcon, ListTodoIcon } from "lucide-react";
import { physical } from "@tanstack/virtual-file-routes";
import * as Effect from "effect/Effect";

import type { Forbidden } from "@ktb/authz";
import { consultationsServicesPlugin } from "@ktb/consultations";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { platformHeaderPlugin } from "@ktb/platform-header";
import { platformAdminPlugin, platformPanelPlugin, PlatformAdmin } from "@ktb/platform";

import { Ops, OpsLive } from "./ops.ts";
import { OpsPlatformPage } from "./platform-page.tsx";
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

/**
 * Ops console services (T-035): the `Ops` port aggregates the signals
 * behind /platform/ops — the audio-pipeline job projection (delegated
 * to Consultations, which re-checks PlatformAdmin) and the host-published
 * queue/storage probes. The dep edge orders it after the consultations
 * services it consumes and the env-composed admin gate.
 */
export const opsServicesPlugin = definePlugin({
	id: "jobs.ops.services",
	requiredDeps: [consultationsServicesPlugin.id, platformAdminPlugin.id],
	services: OpsLive,
});

// Panel (system console) contribution: /platform/ops is mounted by the
// platform plugin's physical route subtree; this plugin declares the
// sidebar entry and page descriptor. The dep edge orders it after the
// shell and the ops services its loader consumes.
export const opsPanelPlugin = definePlugin({
	id: "jobs.panel",
	requiredDeps: [platformPanelPlugin.id, opsServicesPlugin.id],
	panel: {
		sidebar: [{ to: "/platform/ops", label: "Ops", icon: ActivityIcon, group: "System" }],
		pages: [
			{
				id: "jobs.ops",
				path: "/platform/ops",
				component: OpsPlatformPage,
				// Hard 404 for non-admins — same contract as the /platform
				// layout guard; every service call re-checks anyway.
				guard: () =>
					Effect.gen(function* () {
						const platformAdmin = yield* PlatformAdmin;
						return yield* platformAdmin.requireAdmin().pipe(
							Effect.as(true),
							Effect.catchTag("Forbidden", () => Effect.succeed(false)),
						);
					}),
				loader: () =>
					Effect.gen(function* () {
						const ops = yield* Ops;
						// Each section degrades independently: a Forbidden or a
						// missing runtime probe yields null → the view renders
						// the unavailable state, never a fabricated zero.
						const section = <A>(effect: Effect.Effect<A, Forbidden>) =>
							effect.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null as A | null)));
						const [jobs, queue, storage] = yield* Effect.all(
							[section(ops.audioJobs()), section(ops.queueDepth()), section(ops.storageStats())],
							{ concurrency: "unbounded" },
						);
						return { jobs, queue, storage };
					}),
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	jobsHeaderPlugin,
	jobsRoutesPlugin,
	opsServicesPlugin,
	opsPanelPlugin,
];

export { JobsDataContext, type ConsoleJob } from "./context.ts";
export {
	isAudioRetryable,
	jobFromAudioRow,
	jobStatusOf,
	jobsFromAudioRows,
	RETRYABLE_AUDIO_STATUSES,
	type AudioJobRow,
} from "./jobs.ts";
export { Ops } from "./ops.ts";
export type { OpsPageData } from "./platform-page.tsx";

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"jobs.header": true;
		"jobs.routes": true;
		"jobs.ops.services": true;
		"jobs.panel": true;
	}
}

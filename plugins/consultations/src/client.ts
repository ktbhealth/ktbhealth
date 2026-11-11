import { ClipboardListIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { ConsultationsPlatformPage } from "./platform-page.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Every server entry keeps its id and dep
 * edges so topo order matches the server registry, but only
 * client-consumed contributions are carried: landing nav and panel
 * sidebar/pages. `panel.pages` keep id/path/component only — the
 * loader/guard Effects run server-side and stay in ./index.ts.
 * tables/services/routes degrade to markers. Dep ids are literals:
 * importing ./index.ts would pull the server graph into the client
 * bundle. Keep in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const consultationsLandingNavPlugin = definePlugin({
	id: "consultations.landing-nav",
	landingNav: [{ to: "/consultations", label: "Consultations" }],
});

export const consultationsPanelPlugin = definePlugin({
	id: "consultations.panel",
	requiredDeps: ["platform.panel"],
	panel: {
		sidebar: [
			{
				to: "/platform/consultations",
				label: "Consultations",
				icon: ClipboardListIcon,
				group: "Domains",
			},
		],
		pages: [
			{
				id: "consultations.admin",
				path: "/platform/consultations",
				component: ConsultationsPlatformPage,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	definePlugin({ id: "consultations.tables" }),
	definePlugin({
		id: "consultations.services",
		requiredDeps: ["patients.services", "platform.admin"],
		// Mirrors consultationsServicesPlugin.optionalDeps (server index.ts).
		optionalDeps: ["audit.services"],
	}),
	definePlugin({ id: "consultations.routes" }),
	consultationsLandingNavPlugin,
	consultationsPanelPlugin,
];

import { UsersIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { PatientsPlatformPage } from "./platform-page.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Every server entry keeps its id and dep
 * edges so topo order matches the server registry, but only
 * client-consumed contributions are carried: landing nav and panel
 * sidebar/pages. `panel.pages` keep id/path/component only — the
 * loader Effect runs server-side and stays in ./index.ts.
 * tables/services/routes degrade to markers. Dep ids are literals:
 * importing ./index.ts would pull the server graph into the client
 * bundle. Keep in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const patientsLandingNavPlugin = definePlugin({
	id: "patients.landing-nav",
	landingNav: [{ to: "/patients", label: "Patients" }],
});

export const patientsPanelPlugin = definePlugin({
	id: "patients.panel",
	requiredDeps: ["platform.panel"],
	panel: {
		sidebar: [{ to: "/platform/patients", label: "Patients", icon: UsersIcon, group: "Domains" }],
		pages: [
			{
				id: "patients.admin",
				path: "/platform/patients",
				component: PatientsPlatformPage,
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	definePlugin({ id: "patients.tables" }),
	definePlugin({
		id: "patients.services",
		requiredDeps: ["platform.admin"],
	}),
	definePlugin({ id: "patients.routes" }),
	patientsLandingNavPlugin,
	patientsPanelPlugin,
];

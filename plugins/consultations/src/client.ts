import { ClipboardListIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { ConsultationsPlatformPage } from "./platform-page.tsx";
import { NewConsultationLink } from "./chrome.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Every server entry keeps its id and dep
 * edges so topo order matches the server registry, but only
 * client-consumed contributions are carried: chrome regions (nav link,
 * CTA, console sidebar) and panel pages. `panel.pages` keep
 * id/path/component only — the loader/guard Effects run server-side and
 * stay in ./index.ts. tables/services/routes degrade to markers. Dep
 * ids are literals: importing ./index.ts would pull the server graph
 * into the client bundle. Keep in sync — parity is asserted by
 * apps/web/src/plugins.test.ts.
 */
export const consultationsChromePlugin = definePlugin({
	id: "consultations.chrome",
	requiredDeps: ["platform.panel"],
	chrome: [
		{
			id: "consultations.nav",
			region: "app.header.nav",
			content: { kind: "link", to: "/consultations", label: "Consultations" },
		},
		{
			id: "consultations.new",
			region: "app.header.actions",
			// Before the locale toggle (unordered → Infinity).
			order: 0,
			content: { kind: "component", component: NewConsultationLink },
		},
		{
			id: "consultations.sidebar",
			region: "console.sidebar",
			content: {
				kind: "sidebarItem",
				item: {
					to: "/platform/consultations",
					label: "Consultations",
					icon: ClipboardListIcon,
					group: "Domains",
				},
			},
		},
	],
});

export const consultationsPanelPlugin = definePlugin({
	id: "consultations.panel",
	requiredDeps: ["platform.panel"],
	meta: {
		name: "Consultations",
		description: "Consultation records and audio jobs",
		icon: ClipboardListIcon,
	},
	panel: {
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
	consultationsChromePlugin,
	consultationsPanelPlugin,
];

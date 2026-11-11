import { ScrollTextIcon } from "lucide-react";

import { definePlugin, type Plugin } from "@ktb/kernel";

import { AuditPlatformPage } from "./platform-page.tsx";

/**
 * Client-safe mirror of ./index.ts — discovered by the browser bundle
 * through `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Only the client-consumed
 * contribution is carried: the panel sidebar entry and page descriptor.
 * `panel.pages` keep id/path/component only — the guard/loader Effects
 * run server-side and stay in ./index.ts. Dep ids are literals:
 * importing ./index.ts would pull the server graph into the client
 * bundle. Keep in sync — parity is asserted by apps/web/src/plugins.test.ts.
 */
export const auditPanelPlugin = definePlugin({
	id: "audit.panel",
	requiredDeps: ["platform.panel", "audit.services"],
	panel: {
		sidebar: [{ to: "/platform/audit", label: "Audit log", icon: ScrollTextIcon, group: "System" }],
		pages: [{ id: "audit.admin", path: "/platform/audit", component: AuditPlatformPage }],
	},
});

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	definePlugin({
		id: "audit.tables",
		// Mirrors auditTablesPlugin (server index.ts) minus the tables
		// slice — drizzle schema never reaches the client bundle.
	}),
	definePlugin({
		id: "audit.services",
		// Mirrors auditServicesPlugin.requiredDeps (server index.ts) —
		// literal id: importing @ktb/platform would pull the server graph
		// into the client bundle.
		requiredDeps: ["platform.admin"],
	}),
	auditPanelPlugin,
];

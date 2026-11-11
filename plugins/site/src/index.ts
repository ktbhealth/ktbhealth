import { definePlugin, type Plugin } from "@ktb/kernel";

import { SiteBrand, SiteLocaleToggle } from "./chrome.tsx";

/**
 * Site chrome plugin (P-060): the app-shell regions owned by @ktb/site —
 * brand block, locale toggle and the footer disclaimer note. Mirrors
 * ./client.ts (the client-discovery manifest); parity is asserted by
 * apps/web/src/plugins.test.ts.
 */
export const siteChromePlugin = definePlugin({
	id: "site.chrome",
	chrome: [
		{
			id: "site.brand",
			region: "app.header.brand",
			content: { kind: "component", component: SiteBrand },
		},
		{
			id: "site.locale",
			region: "app.header.actions",
			content: { kind: "component", component: SiteLocaleToggle },
		},
		{
			id: "site.footer-note",
			region: "app.footer.note",
			content: {
				kind: "note",
				key: "disclaimer",
				fallback:
					"KTB is a documentation tool: the physician holds total decision. The anamnesis is a draft and must be reviewed by the responsible physician.",
			},
		},
	],
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [siteChromePlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"site.chrome": true;
	}
}

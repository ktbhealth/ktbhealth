import { definePlugin, type Plugin } from "@ktb/kernel";

import { SiteBrand, SiteLocaleToggle } from "./chrome.tsx";

/**
 * Client-safe plugin entry — discovered by the browser bundle through
 * `@ktb/app-host/client` (import.meta.glob on
 * `plugins/<name>/src/client.ts`). Single contribution: the app-shell
 * chrome owned by @ktb/site — brand block, locale toggle and the footer
 * disclaimer note (P-060). No server-side contributions, so ./index.ts
 * simply re-exports this module. Keep in sync — parity is asserted by
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

/** Single-concern plugins contributed by this module — the client
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [siteChromePlugin];

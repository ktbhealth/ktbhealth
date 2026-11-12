import { FileTextIcon } from "lucide-react";
import * as Effect from "effect/Effect";

import { definePlugin, type Plugin } from "@ktb/kernel";
import { PlatformAdmin, platformAdminPlugin, platformPanelPlugin } from "@ktb/platform";

import { CustomNavLinks } from "./chrome.tsx";
import { PagesAdminConsolePage } from "./platform-page.tsx";
import { customPage } from "./schema.ts";
import { CustomPages, CustomPagesLive } from "./service.ts";
import { CustomPageView } from "./views/CustomPageView.tsx";

/**
 * Custom pages plugin (T-083): admin-authored pages stored in the
 * `custom_pages` table and rendered through the generic `pages`
 * contribution — the P-059 mechanism built for exactly this. One
 * "/*" wildcard descriptor serves every unpublished path: its `guard`
 * 404s paths with no published row and its `loader` returns the row,
 * so DB pages need no code and no route files. `publishedByPath` /
 * `navList` are public reads (anonymous visitors render published
 * pages); every admin method re-checks PlatformAdmin inside the
 * service.
 */

export const pagesTablesPlugin = definePlugin({
	id: "pages.tables",
	tables: { customPage },
});

export const pagesServicesPlugin = definePlugin({
	id: "pages.services",
	// adminList/adminCreate/adminUpdate/adminRemove consume the
	// PlatformAdmin gate — the dep edge keeps the platform module
	// ordered (and discovered) before this plugin's layer.
	requiredDeps: [platformAdminPlugin.id],
	services: CustomPagesLive,
});

/**
 * Chrome contribution (P-060): the /platform/pages console sidebar
 * entry (System group) plus the app-header nav component that lists
 * published pages flagged `showInNav` — fetched at render time via the
 * plugin's public server fn, so nav membership is data, not code.
 */
export const pagesChromePlugin = definePlugin({
	id: "pages.chrome",
	requiredDeps: [platformPanelPlugin.id],
	chrome: [
		{
			id: "pages.sidebar",
			region: "console.sidebar",
			content: {
				kind: "sidebarItem",
				item: {
					to: "/platform/pages",
					label: "Pages",
					icon: FileTextIcon,
					group: "System",
				},
			},
		},
		{
			id: "pages.nav",
			region: "app.header.nav",
			content: { kind: "component", component: CustomNavLinks },
		},
	],
});

/**
 * Wildcard page descriptor: claims every app path no exact descriptor
 * or file route owns. `guard` resolves the request path against the
 * published-page table (false → the host 404s exactly like an unknown
 * path); `loader` returns the row as `data`. Both receive the request
 * path — the kernel contract for wildcard pages. The component is
 * shared by every custom page; per-page content arrives via `data`.
 */
export const pagesRenderPlugin = definePlugin({
	id: "pages.render",
	requiredDeps: [pagesServicesPlugin.id],
	pages: [
		{
			id: "pages.custom",
			path: "/*",
			context: "app",
			component: CustomPageView,
			guard: (path) =>
				Effect.gen(function* () {
					const pages = yield* CustomPages;
					return (yield* pages.publishedByPath(path)) !== null;
				}),
			loader: (path) =>
				Effect.gen(function* () {
					const pages = yield* CustomPages;
					return yield* pages.publishedByPath(path);
				}),
		},
	],
});

/**
 * Panel (system console) contribution: /platform/pages is the admin
 * CRUD surface. The loader returns every row (drafts included); the
 * service re-checks the admin gate. `guard` hard-404s non-admins —
 * same contract as the /platform layout gate.
 */
export const pagesPanelPlugin = definePlugin({
	id: "pages.panel",
	requiredDeps: [platformPanelPlugin.id, pagesServicesPlugin.id],
	panel: {
		pages: [
			{
				id: "pages.admin",
				path: "/platform/pages",
				component: PagesAdminConsolePage,
				// Path arg unused — the admin page is exact-path — but the
				// kernel signature passes the request path.
				guard: (_path) =>
					Effect.gen(function* () {
						const platformAdmin = yield* PlatformAdmin;
						return yield* platformAdmin.requireAdmin().pipe(
							Effect.as(true),
							Effect.catchTag("Forbidden", () => Effect.succeed(false)),
						);
					}),
				loader: (_path) =>
					Effect.gen(function* () {
						const pages = yield* CustomPages;
						return yield* pages
							.adminList()
							.pipe(Effect.catchTag("Forbidden", () => Effect.succeed([])));
					}),
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [
	pagesTablesPlugin,
	pagesServicesPlugin,
	pagesChromePlugin,
	pagesRenderPlugin,
	pagesPanelPlugin,
];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"pages.tables": true;
		"pages.services": true;
		"pages.chrome": true;
		"pages.render": true;
		"pages.panel": true;
	}
}

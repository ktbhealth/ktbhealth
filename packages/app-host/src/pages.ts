import type { Page, Plugin } from "@ktb/kernel";

/**
 * Unified page registry (P-059): every page a plugin contributes —
 * `panel.pages` console descriptors AND generic `pages` entries —
 * keyed by absolute path, split by the shell that dispatches them.
 * "console" pages live under /platform behind the admin gate; "app"
 * pages render inside the marketing shell via the root splat route and
 * may be public. `panel.pages` entries count as context "console".
 *
 * The registry is computed by the caller (`collectPages`) — this module
 * stays registry-agnostic so any plugin list can be merged; the client
 * entry (`./client.ts`) runs it once over the discovered `plugins`.
 */

/** Which host shell owns a page: the /platform console or the app
 * marketing shell. */
export type PageShell = "app" | "console";

/** A page descriptor plus the id of the plugin that owns it — the
 * enabled-state gate (`*PageDataFn`) and the route dispatchers need
 * the owner id, which the bare page object doesn't carry. */
export interface PageEntry {
	readonly page: Page;
	readonly pluginId: string;
	readonly context?: PageShell;
}

export interface PageRegistry {
	/** Every contributed page by path — first contributor in topo
	 * order wins; later duplicates are dropped with a dev warning. */
	readonly pages: ReadonlyMap<string, PageEntry>;
	/** App-shell pages only — the root `/$` splat dispatches through
	 * this map. */
	readonly appPages: ReadonlyMap<string, PageEntry>;
	/** Console pages only — the /platform index and `$` routes
	 * dispatch through this map (exported as `consolePages`). */
	readonly consolePages: ReadonlyMap<string, PageEntry>;
}

const CONSOLE_ROOT = "/platform";

/** /platform and anything beneath it belongs to the console shell. */
export const isConsolePath = (path: string): boolean =>
	path === CONSOLE_ROOT || path.startsWith(`${CONSOLE_ROOT}/`);

/** Context derived from the path when the descriptor doesn't declare
 * one: /platform* → console, everything else → app. */
export const defaultPageContext = (path: string): PageShell =>
	isConsolePath(path) ? "console" : "app";

const devWarn = (message: string): void => {
	if (import.meta.env.DEV) {
		// eslint-disable-next-line no-console -- dev-only diagnostic
		console.warn(message);
	}
};

/**
 * Merge every page contribution of `registry` into path-keyed maps.
 * Iteration order is the plugin topo order, so the FIRST plugin to
 * claim a path wins; duplicates are skipped with a dev warning (the
 * kernel contract asks plugins for unique paths — this is the
 * runtime backstop, same role `orderPlugins` plays for dep edges).
 * An app-context page claiming a /platform* path is a contract
 * violation: warned and ignored (console paths are console by
 * definition). A console-context page outside /platform is warned and
 * ignored too — no dispatcher reaches it.
 */
export const collectPages = (registry: readonly Plugin[]): PageRegistry => {
	const pages = new Map<string, PageEntry>();
	const appPages = new Map<string, PageEntry>();
	const consolePages = new Map<string, PageEntry>();
	const add = (plugin: Plugin, page: Page, context: PageShell) => {
		if (pages.has(page.path)) {
			devWarn(
				`[pages] path "${page.path}" claimed by both "${pages.get(page.path)?.pluginId}" ` +
					`and "${plugin.id}" — first in topo order wins`,
			);
			return;
		}
		const entry: PageEntry = { page, pluginId: plugin.id, context };
		pages.set(page.path, entry);
		(context === "app" ? appPages : consolePages).set(page.path, entry);
	};
	for (const plugin of registry) {
		// panel.pages are console pages by definition (P-050).
		for (const page of plugin.panel?.pages ?? []) add(plugin, page, "console");
		for (const page of plugin.pages ?? []) {
			const context = page.context ?? defaultPageContext(page.path);
			if (context === "app" && isConsolePath(page.path)) {
				devWarn(
					`[pages] "${plugin.id}" claims console path "${page.path}" as app context — ignored`,
				);
				continue;
			}
			if (context === "console" && !isConsolePath(page.path)) {
				devWarn(
					`[pages] "${plugin.id}" marks "${page.path}" as console but it is not under /platform — ignored`,
				);
				continue;
			}
			add(plugin, page, context);
		}
	}
	return { pages, appPages, consolePages };
};

/**
 * Resolve the page entry for a request path: exact-path descriptors win;
 * failing that, wildcard entries — keys ending in "/*" (same syntax as
 * chrome `when` paths) whose base prefixes `path` — are considered, and
 * the LONGEST matching base wins. Ties keep the first entry in map
 * (topo) order. This is what lets a single DB-backed descriptor (e.g.
 * the custom-pages plugin's "/*") serve every path it resolves.
 */
export const findPage = <V>(map: ReadonlyMap<string, V>, path: string): V | undefined => {
	const exact = map.get(path);
	if (exact !== undefined) return exact;
	let best: V | undefined;
	let bestBase = -1;
	for (const [key, entry] of map) {
		if (!key.endsWith("/*")) continue;
		const base = key.slice(0, -2);
		const matches =
			base === "" ? path.startsWith("/") : path === base || path.startsWith(`${base}/`);
		if (matches && base.length > bestBase) {
			best = entry;
			bestBase = base.length;
		}
	}
	return best;
};

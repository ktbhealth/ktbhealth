import { discoverPlugins, orderPlugins } from "@ktb/driver-framework";
import type { Plugin } from "@ktb/kernel";
import { plugins as platformClientPlugins } from "@ktb/platform/client";

import { collectPages } from "./pages.ts";

/**
 * Client-safe plugin registry: every module under plugins/<name>/src/client.ts
 * exporting `plugins` is registered, topo-sorted by
 * `requiredDeps`/`optionalDeps` — the same discovery convention as the
 * server registry in ./index.ts, but each client manifest carries only
 * what the browser bundle may see (nav/panel/landing contributions; no
 * tables, services, Layers, CQRS groups or page loader/guard Effects).
 * import.meta.glob is a build-time transform — Vite emits static imports.
 *
 * @ktb/platform's client manifest (@ktb/platform/client) is registered
 * explicitly alongside the plugins/* glob — packages/platform lives below
 * the plugin system but still contributes registry entries (T-088).
 */
export const plugins: readonly Plugin[] = orderPlugins(
	discoverPlugins({
		// Same glob as ./index.ts — eval packs included (P-070); their
		// client.ts mirrors are bare-id markers since eval.*
		// contributions have no browser consumer.
		...import.meta.glob("../../../plugins/*/src/client.ts", { eager: true }),
		"@ktb/platform/client": { plugins: platformClientPlugins },
	}),
);

// Registry-derived collections (P-058/P-059/P-060): pure helpers over the
// plugin list, re-exported so apps consume one client entry. The page
// maps are computed once here — the registry is static.
export * from "./chrome.ts";
export * from "./pages.ts";
export * from "./plugin-state.ts";

/** Every contributed page by path (first in topo order wins). */
export const { pages, appPages, consolePages } = collectPages(plugins);

import type { PanelPage } from "@ktb/kernel";

import { plugins } from "#/plugins.ts";

/**
 * Every `panel.pages` descriptor contributed by the discovered plugins,
 * keyed by full route path ("/platform" or nested "/platform/<segment>…").
 * The plugin registry is static, so the map is built once at module load.
 * The /platform index and $ splat routes dispatch through this lookup;
 * paths must be unique across plugins (kernel contract).
 */
export const platformPages: ReadonlyMap<string, PanelPage> = new Map(
	plugins.flatMap((p) => (p.panel?.pages ?? []).map((page) => [page.path, page] as const)),
);

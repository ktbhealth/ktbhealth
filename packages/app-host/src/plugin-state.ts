/**
 * Client-side enabled-plugin filtering (P-058). `pluginStatesFn` returns
 * the enabled id set (no `plugin_state` row = enabled); every registry
 * consumer filters through `enabledPlugins` before reading
 * chrome/landing/panel contributions so a disabled plugin renders
 * nothing. Server-side enforcement lives in the page data fns
 * (`platformPageDataFn`/`appPageDataFn` → notfound) and the CQRS
 * dispatch gate in @ktb/app-host.
 */

/** Wire shape of `pluginStatesFn`. */
export interface PluginStatesResult {
	readonly enabled: readonly string[];
}

export const enabledIdSet = (states: PluginStatesResult): ReadonlySet<string> =>
	new Set(states.enabled);

/** Plugins whose id is in the enabled set, topo order preserved. */
export const enabledPlugins = <T extends { readonly id: string }>(
	plugins: readonly T[],
	enabled: ReadonlySet<string>,
): T[] => plugins.filter((p) => enabled.has(p.id));

/** Whether any plugin id of a package (`plugins/<pkg>/*` → `<pkg>.*`)
 * is enabled — mirrors the CQRS gate granularity in @ktb/app-host. */
export const packageEnabled = (enabled: ReadonlySet<string>, pkg: string): boolean => {
	const prefix = `${pkg}.`;
	for (const id of enabled) {
		if (id.startsWith(prefix)) return true;
	}
	return false;
};

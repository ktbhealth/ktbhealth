import type { PanelPageContext } from "@ktb/kernel";

import type { PluginStateEntry } from "@ktb/platform/plugin-states";

import { PluginsPage } from "./views/PluginsPage.tsx";

interface ManagerPageData {
	states: readonly PluginStateEntry[];
}

const configObject = (config: unknown): Record<string, unknown> =>
	typeof config === "object" && config !== null && !Array.isArray(config)
		? (config as Record<string, unknown>)
		: {};

/**
 * `panel.pages` component for /platform/plugins (P-058): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it into the view's props. `ctx.plugins` is the FULL client
 * registry — the manager must see disabled plugins to re-enable them.
 * The page's own `meta.config` (`cascadeConfirm`) is read back here so
 * the dogfooded config field actually does something.
 */
export function ManagerPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const { states } = data as ManagerPageData;
	const map = new Map(states.map((s) => [s.pluginId, s] as const));
	const self = map.get("manager.panel");
	const cascadeConfirm = configObject(self?.config).cascadeConfirm !== false;
	return (
		<PluginsPage
			plugins={ctx.plugins}
			states={map}
			locale={ctx.locale}
			cascadeConfirm={cascadeConfirm}
		/>
	);
}

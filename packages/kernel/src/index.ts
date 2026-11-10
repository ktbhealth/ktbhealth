import type { Plugin } from "./contributions.ts";

export type { PluginRegistry, PluginId } from "./core.ts";
export type {
	LandingFooterBlock,
	LandingFooterPlugin,
	LandingLink,
	LandingNavPlugin,
	LandingPlugin,
	MarkerPlugin,
	PanelHeaderAction,
	PanelPage,
	PanelPageContext,
	PanelPlugin,
	PanelSidebarItem,
	Plugin,
	RoutesPlugin,
	ServicesPlugin,
	TablesPlugin,
} from "./contributions.ts";

export const definePlugin = <const P extends Plugin>(plugin: P): P => plugin;

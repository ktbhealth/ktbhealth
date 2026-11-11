/**
 * Module boundary: `core.ts` is the UI-framework-neutral registry
 * contract (PluginRegistry/PluginId/PluginBase/ForbiddenContributions —
 * zero imports). `contributions.ts` carries the host-chrome contract:
 * the Plugin union and its prop types reference React/TanStack/drizzle/
 * effect, but ONLY via `import type` against devDependencies, so the
 * emitted package stays dependency-free and server consumers
 * (driver-framework, app-host) never pull UI runtime. The union must
 * stay whole — `ForbiddenContributions` gives each member compile-time
 * exclusivity over the other contribution keys.
 */
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

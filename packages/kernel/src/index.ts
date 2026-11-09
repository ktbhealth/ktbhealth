import type { ComponentType } from "react";
import type { VirtualRouteNode } from "@tanstack/virtual-file-routes";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";

/**
 * Registry of plugin ids known at compile time. Each plugin entry module
 * contributes its ids via `declare module "@ktb/kernel"` augmentation;
 * `requiredDeps`/`optionalDeps` are typed against `keyof PluginRegistry`,
 * so a dep on an undeclared id fails typecheck at the plugin's own
 * declaration — as long as the dep's entry module is imported (directly
 * or transitively) so its augmentation is part of the program.
 * `orderPlugins` (@ktb/driver-framework) re-validates every dep at
 * runtime: that is the backstop for plugin modules reached through
 * import.meta.glob that the typechecker never loaded.
 */
export interface PluginRegistry {}

export type PluginId = Extract<keyof PluginRegistry, string>;

/** One entry in a plugin's system-console sidebar. `icon` is any
 * component accepting `className` (lucide icons qualify); the host
 * shell sizes it via `[&_svg]` rules. `exact` marks index-style items
 * that must not stay active on descendant routes. */
export interface PanelSidebarItem {
	readonly to: string;
	readonly label: string;
	readonly icon?: ComponentType<{ className?: string }>;
	readonly exact?: boolean;
	/** Sidebar group label — items cluster under it in declaration
	 * (topo) order; groups order by first appearance. Defaults to a
	 * single unlabeled group. */
	readonly group?: string;
}

/** One entry in a plugin's console top-bar right side. `component` is a
 * self-contained React component (icon button, popover, badge…) rendered
 * by the shell; data reaches it via plugin-owned contexts/props the host
 * injects — plugins cannot import apps or server fns. */
export interface PanelHeaderAction {
	readonly id: string;
	readonly component: ComponentType;
}

/** Host-injected context handed to every panel page component — the
 * discovered plugin registry, so console pages can render
 * plugin-aware views without importing the app host. */
export interface PanelPageContext {
	readonly plugins: readonly Plugin[];
}

/** A console page contributed via `panel.pages` (P-050): the host
 * mounts a generic dispatcher at `path` under /platform, runs `loader`
 * as an Effect under the session principal (`runAs` binds Principal +
 * AuthzLive — authz stays inside the domain services), and renders
 * `component` with the result as `data`. `loader` runs on every
 * navigation, like a route loader; pages without one get `data: null`.
 * `path` must be a single segment under /platform ("/platform" itself
 * or "/platform/<name>") — the host's param route only matches one. */
export interface PanelPage {
	readonly id: string;
	readonly path: string;
	readonly component: ComponentType<{ data: unknown; ctx: PanelPageContext }>;
	readonly loader?: () => Effect.Effect<unknown, unknown, unknown>;
}

/**
 * Feature plugin contract. The host (apps/web) registers plugins in a
 * static list; each plugin object contributes EXACTLY ONE kind of
 * contribution — every union member below forbids the other
 * contribution keys (`?: never`), so a multi-concern plugin object is a
 * compile error. A plugin that only anchors dependency edges (e.g.
 * `platform.admin`, `platform.panel`) is a MarkerPlugin: no contribution
 * field at all. Everything is statically imported — workerd can't do
 * dynamic module loading, and static keeps 100% type safety.
 *
 * Consumers read a contribution with optional access (`p.landingNav ?? []`) —
 * forbidden keys are declared `?: never`, so `"<field>" in p` does not
 * discriminate the union.
 */
interface PluginBase {
	readonly id: string;
	/** Hard dependency: the dep's services compose before this plugin's
	 * (topo order) and composition fails when the dep is absent. */
	readonly requiredDeps?: readonly PluginId[];
	/** Ordering hint only: the dep may be absent. A plugin must NOT
	 * require an optional dep's services in its layer — absence is legal,
	 * so a layer requirement on it would break composition. Layers are
	 * type-erased (`Layer.Any`), so this is a documented contract, not a
	 * statically enforced one. */
	readonly optionalDeps?: readonly PluginId[];
}

type ContributionField =
	| "tables"
	| "services"
	| "routes"
	| "landingNav"
	| "landing"
	| "landingFooter"
	| "panel";

/** Marks every contribution field EXCEPT `K` as forbidden (`?: never`). */
type ForbiddenContributions<K extends ContributionField> = {
	readonly [F in Exclude<ContributionField, K>]?: never;
};

/** Dependency anchor only — no contribution of its own. */
export interface MarkerPlugin extends PluginBase, ForbiddenContributions<never> {}

/** Drizzle table slice composed into @ktb/db/schema. */
export interface TablesPlugin extends PluginBase, ForbiddenContributions<"tables"> {
	readonly tables: Record<string, SQLiteTable>;
}

/** Effect layers: services the plugin needs/provides at runtime.
 * Heterogeneous by design: each plugin provides its own services.
 * Type-erased to Layer.Any; the host verifies requirements at
 * ManagedRuntime composition. */
export interface ServicesPlugin extends PluginBase, ForbiddenContributions<"services"> {
	readonly services: Layer.Any;
}

/** Route subtree composed into the host's virtualRouteConfig. */
export interface RoutesPlugin extends PluginBase, ForbiddenContributions<"routes"> {
	readonly routes: readonly VirtualRouteNode[];
}

/** A link contributed to the landing chrome (header nav, footer blocks). */
export interface LandingLink {
	readonly to: string;
	readonly label: string;
}

/** One block in the landing footer: optional heading + link list. */
export interface LandingFooterBlock {
	readonly heading?: string;
	readonly links: ReadonlyArray<LandingLink>;
}

/** Links surfaced in the host's landing/app header. */
export interface LandingNavPlugin extends PluginBase, ForbiddenContributions<"landingNav"> {
	readonly landingNav: ReadonlyArray<LandingLink>;
}

/** Whole-page landing slot: the host renders the first landing plugin's
 * `page` at "/" in topo order instead of the built-in landing. At most
 * one landing plugin should exist — additional ones are ignored. */
export interface LandingPlugin extends PluginBase, ForbiddenContributions<"landing"> {
	readonly landing: {
		readonly page: ComponentType;
	};
}

/** Footer blocks rendered by the host's landing chrome, in topo order. */
export interface LandingFooterPlugin extends PluginBase, ForbiddenContributions<"landingFooter"> {
	readonly landingFooter: {
		readonly blocks: ReadonlyArray<LandingFooterBlock>;
	};
}

/** System-console (panel) contribution: sidebar entries rendered by
 * the /platform shell, ordered by plugin topo order. */
export interface PanelPlugin extends PluginBase, ForbiddenContributions<"panel"> {
	readonly panel: {
		readonly sidebar?: ReadonlyArray<PanelSidebarItem>;
		/** Top-bar actions rendered on the right side of the console
		 * header, in plugin topo order. Only taken into account when the
		 * `platform.header` extension point is present. */
		readonly headerActions?: ReadonlyArray<PanelHeaderAction>;
		/** Console pages the host dispatches under /platform — each
		 * `path` gets a generic route that runs `loader` and renders
		 * `component`. Paths must be unique across plugins. */
		readonly pages?: ReadonlyArray<PanelPage>;
	};
}

export type Plugin =
	| MarkerPlugin
	| TablesPlugin
	| ServicesPlugin
	| RoutesPlugin
	| LandingNavPlugin
	| LandingPlugin
	| LandingFooterPlugin
	| PanelPlugin;

export const definePlugin = <const P extends Plugin>(plugin: P): P => plugin;

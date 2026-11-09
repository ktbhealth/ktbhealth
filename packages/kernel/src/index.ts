import type { ComponentType } from "react";
import type { VirtualRouteNode } from "@tanstack/virtual-file-routes";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
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
 * Consumers read a contribution with optional access (`p.nav ?? []`) —
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

type ContributionField = "tables" | "services" | "routes" | "nav" | "panel";

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

/** Nav links surfaced in the host shell. */
export interface NavPlugin extends PluginBase, ForbiddenContributions<"nav"> {
	readonly nav: ReadonlyArray<{ to: string; label: string }>;
}

/** System-console (panel) contribution: sidebar entries rendered by
 * the /platform shell, ordered by plugin topo order. */
export interface PanelPlugin extends PluginBase, ForbiddenContributions<"panel"> {
	readonly panel: {
		readonly sidebar?: ReadonlyArray<PanelSidebarItem>;
	};
}

export type Plugin =
	| MarkerPlugin
	| TablesPlugin
	| ServicesPlugin
	| RoutesPlugin
	| NavPlugin
	| PanelPlugin;

export const definePlugin = <const P extends Plugin>(plugin: P): P => plugin;

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

/**
 * Feature plugin contract. The host (apps/web) registers plugins in a
 * static list; each plugin contributes routes, nav, schema slices and
 * Effect services. Everything is statically imported — workerd can't
 * do dynamic module loading, and static keeps 100% type safety.
 */
export interface Plugin {
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
	/** Route subtree composed into the host's virtualRouteConfig. */
	readonly routes?: readonly VirtualRouteNode[];
	/** Nav links surfaced in the host shell. */
	readonly nav?: ReadonlyArray<{ to: string; label: string }>;
	/** Drizzle table slice composed into @ktb/db/schema. */
	readonly tables?: Record<string, SQLiteTable>;
	/** Effect layers: services the plugin needs/provides at runtime. */
	/** Heterogeneous by design: each plugin provides its own services.
	 * Type-erased to Layer.Any; the host verifies requirements at
	 * ManagedRuntime composition. */
	readonly services?: Layer.Any;
}

export const definePlugin = <const P extends Plugin>(plugin: P): P => plugin;

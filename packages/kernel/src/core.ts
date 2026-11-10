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

export interface PluginBase {
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

export type ContributionField =
	| "tables"
	| "services"
	| "routes"
	| "landingNav"
	| "landing"
	| "landingFooter"
	| "panel";

/** Marks every contribution field EXCEPT `K` as forbidden (`?: never`). */
export type ForbiddenContributions<K extends ContributionField> = {
	readonly [F in Exclude<ContributionField, K>]?: never;
};

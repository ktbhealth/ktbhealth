import { Graph } from "effect";
import type { Plugin } from "@ktb/kernel";

export * from "./drivers.ts";

interface PluginModule {
	readonly plugin?: Plugin;
}

const isPlugin = (value: unknown): value is Plugin =>
	typeof value === "object" && value !== null && typeof (value as Plugin).id === "string";

/**
 * Filter Vite `import.meta.glob(..., { eager: true })` modules down to
 * plugin exports. Convention: a module is a plugin iff it exports a
 * `plugin` value satisfying the Plugin contract.
 */
export const discoverPlugins = (modules: Record<string, unknown>): Plugin[] =>
	Object.values(modules)
		.map((m) => (typeof m === "object" && m !== null ? (m as PluginModule).plugin : undefined))
		.filter(isPlugin);

/**
 * Topologically sort plugins by their deps using effect/Graph.
 * `requiredDeps` are hard edges: an id that resolves to no discovered
 * plugin throws eagerly, and absent deps would also fail layer
 * composition. `optionalDeps` are ordering hints — edges are added only
 * when the id resolves, so a missing optional dep is silently ignored.
 * Duplicate plugin ids throw eagerly; dependency cycles surface as
 * GraphError from Graph.topo.
 */
export const orderPlugins = (plugins: readonly Plugin[]): Plugin[] => {
	const byId = new Map<string, Plugin>();
	for (const p of plugins) {
		if (byId.has(p.id)) throw new Error(`duplicate plugin id "${p.id}"`);
		byId.set(p.id, p);
	}
	for (const p of plugins)
		for (const dep of p.requiredDeps ?? [])
			if (!byId.has(dep)) throw new Error(`plugin "${p.id}" requires unknown plugin "${dep}"`);

	const edges = (p: Plugin): readonly string[] => [
		...new Set([...(p.requiredDeps ?? []), ...(p.optionalDeps ?? []).filter((d) => byId.has(d))]),
	];

	const graph = Graph.directed<Plugin, null>((mutable) => {
		const nodes = new Map<string, Graph.NodeIndex>();
		for (const p of plugins) nodes.set(p.id, Graph.addNode(mutable, p));
		for (const p of plugins)
			for (const dep of edges(p)) Graph.addEdge(mutable, nodes.get(dep)!, nodes.get(p.id)!, null);
	});
	return Array.from(Graph.values(Graph.topo(graph)));
};

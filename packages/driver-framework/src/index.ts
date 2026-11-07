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
 * Topologically sort plugins by `deps` (plugin ids) using effect/Graph.
 * Throws on unknown deps eagerly; cycles surface as GraphError from
 * Graph.topo at composition time.
 */
export const orderPlugins = (plugins: readonly Plugin[]): Plugin[] => {
	const byId = new Map(plugins.map((p) => [p.id, p]));
	for (const p of plugins)
		for (const dep of p.deps ?? [])
			if (!byId.has(dep)) throw new Error(`plugin "${p.id}" depends on unknown plugin "${dep}"`);

	const graph = Graph.directed<Plugin, null>((mutable) => {
		const nodes = new Map<string, Graph.NodeIndex>();
		for (const p of plugins) nodes.set(p.id, Graph.addNode(mutable, p));
		for (const p of plugins)
			for (const dep of p.deps ?? [])
				Graph.addEdge(mutable, nodes.get(dep)!, nodes.get(p.id)!, null);
	});
	return Array.from(Graph.values(Graph.topo(graph)));
};

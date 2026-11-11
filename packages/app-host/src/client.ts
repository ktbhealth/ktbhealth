import { discoverPlugins, orderPlugins } from "@ktb/driver-framework";
import type { Plugin } from "@ktb/kernel";

/**
 * Client-safe plugin registry: every module under plugins/<name>/src/client.ts
 * exporting `plugins` is registered, topo-sorted by
 * `requiredDeps`/`optionalDeps` — the same discovery convention as the
 * server registry in ./index.ts, but each client manifest carries only
 * what the browser bundle may see (nav/panel/landing contributions; no
 * tables, services, Layers, CQRS groups or page loader/guard Effects).
 * import.meta.glob is a build-time transform — Vite emits static imports.
 */
export const plugins: readonly Plugin[] = orderPlugins(
	discoverPlugins(import.meta.glob("../../../plugins/*/src/client.ts", { eager: true })),
);

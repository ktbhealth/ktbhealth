import { definePlugin, type Plugin } from "@ktb/kernel";

/**
 * Client-safe mirror of ./index.ts — registered explicitly by
 * `@ktb/app-host/client` via the `@ktb/platform/client` subpath (this
 * package lives below the plugin system, so the plugins/* filesystem
 * glob does not reach it). None of the platform entries carry
 * client-consumed contributions the host reads at runtime (the routes
 * contribution is only consumed by route typegen), so every entry is a
 * marker preserving id and dep edges for topo order and feature checks.
 * Dep ids are literals: importing ./index.ts would pull the server
 * graph into the client bundle. Keep in sync — parity is asserted by
 * apps/web/src/plugins.test.ts.
 */
export const plugins: readonly Plugin[] = [
	definePlugin({ id: "platform.admin" }),
	definePlugin({ id: "platform.routes" }),
	definePlugin({ id: "platform.panel", requiredDeps: ["platform.routes"] }),
];

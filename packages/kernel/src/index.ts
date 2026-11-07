import type { VirtualRouteSubtreeConfig } from "@tanstack/virtual-file-routes";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type * as Layer from "effect/Layer";

/**
 * Feature plugin contract. The host (apps/web) registers plugins in a
 * static list; each plugin contributes routes, nav, schema slices and
 * Effect services. Everything is statically imported — workerd can't
 * do dynamic module loading, and static keeps 100% type safety.
 */
export interface Plugin {
	readonly id: string;
	/** Route subtree composed into the host's virtualRouteConfig. */
	readonly routes?: VirtualRouteSubtreeConfig;
	/** Nav links surfaced in the host shell. */
	readonly nav?: ReadonlyArray<{ to: string; label: string }>;
	/** Drizzle table slice composed into @ktb/db/schema. */
	readonly tables?: Record<string, SQLiteTable>;
	/** Effect layers: services the plugin needs/provides at runtime. */
	readonly services?: Layer.Layer<never, unknown, unknown>;
}

export const definePlugin = <P extends Plugin>(plugin: P): P => plugin;

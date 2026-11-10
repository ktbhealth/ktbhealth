import type * as Effect from "effect/Effect";

/** What the app asks for. Provider-agnostic deploy specs. */

export interface StaticSiteSpec {
	readonly name: string;
	/** Shell command that produces `outdir`. Provider supplies a default. */
	readonly command?: string;
	readonly outdir: string;
}

export interface WorkerSpec extends StaticSiteSpec {
	/**
	 * Worker entrypoint path or file:// URL. With `bundle: false` it must
	 * point at a complete, runtime-ready ESM module produced by the build.
	 */
	readonly main: string;
	/**
	 * When false, `main` and sibling modules upload byte-for-byte with no
	 * bundling (Wrangler's `no_bundle` contract). Default: provider bundles.
	 */
	readonly bundle?: boolean;
	readonly bindings?: Record<string, unknown>;
	readonly compatibilityFlags?: readonly string[];
}

export interface SqlDatabaseSpec {
	readonly name: string;
	readonly migrationsDir?: string;
}

/**
 * What a provider hands back. The url/db are opaque handles: Alchemy
 * resolves its `Output<T>` at deploy time, another provider may hand a
 * plain value. The port deliberately exposes neither.
 */
export interface DeployedSite {
	readonly url: unknown;
}

export interface DeployedWorker {
	readonly url: unknown;
	/** Worker script name — needed to attach queue consumers. Opaque handle
	 * (may be a provider Output resolved at deploy time). */
	readonly scriptName?: unknown;
}

export interface DeployedSqlDatabase {
	readonly db: unknown;
}

/** Provider ports. `R` is the provider services the stack wires via `providers:`. */
export type DeployStaticSite<R = never> = (
	spec: StaticSiteSpec,
) => Effect.Effect<DeployedSite, never, R>;

export type DeployWorker<R = never> = (spec: WorkerSpec) => Effect.Effect<DeployedWorker, never, R>;

export type DeploySqlDatabase<R = never> = (
	spec: SqlDatabaseSpec,
) => Effect.Effect<DeployedSqlDatabase, never, R>;

import type * as Effect from "effect/Effect";

/** What the app asks for. Provider-agnostic deploy specs. */

export interface StaticSiteSpec {
	readonly name: string;
	readonly command: string;
	readonly outdir: string;
}

export interface WorkerSpec extends StaticSiteSpec {
	/** SSR worker entrypoint, e.g. "@tanstack/react-start/server-entry". */
	readonly main: string;
	readonly bindings?: Record<string, unknown>;
	readonly compatibilityFlags?: readonly string[];
}

export interface D1Spec {
	readonly name: string;
	readonly migrationsDir?: string;
}

/** What a provider hands back. `TUrl`/`TDb` are provider-defined: Alchemy
 * resources expose outputs as `Output<T>` resolved at deploy time. */
export interface DeployedSite<TUrl = unknown> {
	readonly url: TUrl;
}

export interface DeployedWorker<TUrl = unknown> {
	readonly url: TUrl;
}

export interface DeployedD1<TDb = unknown> {
	readonly db: TDb;
}

/** Provider ports. `R` is the provider services the stack wires via `providers:`. */
export type DeployStaticSite<TUrl = unknown, R = never> = (
	spec: StaticSiteSpec,
) => Effect.Effect<DeployedSite<TUrl>, never, R>;

export type DeployWorker<TUrl = unknown, R = never> = (
	spec: WorkerSpec,
) => Effect.Effect<DeployedWorker<TUrl>, never, R>;

export type DeployD1<TDb = unknown, R = never> = (
	spec: D1Spec,
) => Effect.Effect<DeployedD1<TDb>, never, R>;

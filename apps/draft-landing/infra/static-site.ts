import type * as Effect from "effect/Effect";

/** What the app asks for: a static site built by a command and served over HTTPS. */
export interface StaticSiteSpec {
	readonly name: string;
	readonly command: string;
	readonly outdir: string;
}

/**
 * What a provider hands back. `TUrl` is provider-defined: Alchemy
 * resources expose outputs as `Output<T>` expressions resolved at
 * deploy time, so the port stays generic instead of pretending the
 * URL is a plain string at plan time.
 */
export interface DeployedSite<TUrl = unknown> {
	readonly url: TUrl;
}

/**
 * Provider port. Implementations live in ./<provider>.ts and carry
 * their own `TUrl` (e.g. an Alchemy `Output`) and `R` (the provider
 * services the stack wires via `providers:`).
 */
export type DeployStaticSite<TUrl = unknown, R = never> = (
	spec: StaticSiteSpec,
) => Effect.Effect<DeployedSite<TUrl>, never, R>;

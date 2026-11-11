import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { TenantSelector } from "./selector.ts";

/**
 * Request-scoped tenancy primitives (P-053) — the dependency-free core
 * shared by the resolver, scoped-repo and authz helpers. Kept separate
 * from `index.ts` so those modules never import the package entry point
 * (no import cycles).
 */

/** Built-in tenant roles, ranked owner > admin > member. Apps may store
 * additional role strings in their directory, but authz grants are
 * expressed against these three — see `tenantAuthz`. */
export type TenantRole = "owner" | "admin" | "member";

/** A tenant as stored/looked up — identity without request role. */
export interface TenantDescriptor {
	readonly id: string | number;
	readonly kind: string;
	readonly slug: string;
	readonly meta?: unknown;
}

/** The request-scoped tenant: descriptor + the caller's role in it. */
export interface Tenant extends TenantDescriptor {
	readonly role: TenantRole;
}

/**
 * Request-scoped tenant — which tenant the current effect acts in.
 *
 * Bound per request by the composition root (`runAs` in @ktb/app-host)
 * next to `Principal`. The default `null` marks personal scope: system
 * contexts (webhooks, jobs, `run()`) stay `null` until explicitly
 * re-bound via `runAsTenant` — ambient tenant is never inherited into
 * background work; an unscoped message is a bug, not a default.
 */
export const Tenant = Context.Reference<Tenant | null>("@ktb/tenant/Tenant", {
	defaultValue: () => null,
});

/**
 * Explicit accessible-tenant set for scoped reads. `null` (default)
 * derives the set from the bound `Tenant` — the active tenant only.
 * System flows that must read across several tenants (a nightly job
 * touching every clinic) bind a wider set via `withTenantAccess`;
 * personal (`NULL`) rows are always part of the visible set.
 */
export const TenantAccess = Context.Reference<readonly (string | number)[] | null>(
	"@ktb/tenant/TenantAccess",
	{ defaultValue: () => null },
);

/** Run `effect` with an explicit accessible-tenant set (system flows). */
export const withTenantAccess = <A, E, R>(
	tenantIds: readonly (string | number)[],
	effect: Effect.Effect<A, E, R>,
) => Effect.provideService(effect, TenantAccess, tenantIds);

/** Re-bind `Tenant` for the duration of `effect` — the system-flow
 * counterpart of `runAs`: queue consumers, webhook handlers and jobs
 * re-enter tenant scope from the `tenant_id` carried on their message
 * payload. Never relies on ambient context. */
export const runAsTenant = <A, E, R>(tenant: Tenant, effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, Tenant, tenant);

/** Selector did not resolve to an accessible tenant (unknown slug,
 * foreign tenant, unauthenticated caller). */
export class TenantNotFound extends Data.TaggedError("TenantNotFound")<{
	readonly selector: TenantSelector;
}> {}

/** Tenant scope is mandatory but none was selected/resolved — the
 * resolver's `"deny"` fallback and `requireTenant` failures. */
export class TenantRequired extends Data.TaggedError("TenantRequired")<{
	readonly reason: string;
}> {}

/** The bound tenant, failing `TenantRequired` when in personal scope. */
export const requireTenant = (path = "tenant") =>
	Effect.flatMap(Tenant, (tenant) =>
		tenant === null
			? Effect.fail(new TenantRequired({ reason: `tenant scope required (${path})` }))
			: Effect.succeed(tenant),
	);

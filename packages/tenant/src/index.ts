import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
	TenantNotFound,
	TenantRequired,
	type Tenant,
	type TenantDescriptor,
	type TenantRole,
} from "./context.ts";
import { isEmptySelector } from "./selector.ts";
import type { TenantSelector } from "./selector.ts";

/**
 * @ktb/tenant — generic request-scoped tenancy for kernel apps (P-053).
 *
 * The package owns the *mechanics* of tenancy; apps own the *data*:
 * tenant kinds, the role→action matrix, selector transport and the
 * membership store are all app-supplied behind the ports below.
 *
 * Three `tenant_id` states, never two: `NULL` = personal row, a value =
 * tenant-owned row. Consent-shared rows (a record visible to *other*
 * tenants) are NEVER modeled by widening `tenant_id` — sharing is an
 * explicit grant row in a separate link table checked as an additional
 * permission, so tenant scope can never leak through the scoping column.
 *
 * Module layout: `./context` holds the request-scoped references and
 * errors, `./selector` the dependency-free header transport, this entry
 * point the resolution ports, `./scoped-repo` the query factory,
 * `./authz` the permix matrix builder, `./rls` the Postgres policies
 * and `./testing` the per-engine isolation harness.
 */

export {
	runAsTenant,
	requireTenant,
	Tenant,
	TenantAccess,
	TenantNotFound,
	TenantRequired,
	withTenantAccess,
	type TenantDescriptor,
	type TenantRole,
} from "./context.ts";
export {
	isEmptySelector,
	TENANT_SELECTOR_HEADERS,
	tenantSelectorFromHeaders,
	type TenantSelector,
} from "./selector.ts";

// ---------- resolution port ----------

/** A user's membership in a tenant: descriptor + their role. */
export interface TenantMembership {
	readonly tenant: TenantDescriptor;
	readonly role: TenantRole;
}

/** Shape implemented by {@link TenantDirectory}. */
export interface TenantDirectoryShape {
	/** Every tenant the user can act in — feeds default selection and
	 * accessible-set construction. */
	readonly membershipsFor: (userId: string) => Effect.Effect<readonly TenantMembership[], unknown>;
	/** Resolve the selector to a tenant the user may act in, or `null`
	 * when no accessible tenant matches. Membership-scoped by contract:
	 * a selector naming a tenant the user does not belong to resolves
	 * `null`, never the foreign tenant. */
	readonly findBySelector: (
		userId: string,
		selector: TenantSelector,
	) => Effect.Effect<Tenant | null, unknown>;
}

/**
 * Membership lookup port — implemented by the app (e.g. backed by the
 * groups plugin's API through its port, never imported directly).
 * `@ktb/tenant` defines the contract; adapters live at the edge.
 */
export class TenantDirectory extends Context.Service<TenantDirectory, TenantDirectoryShape>()(
	"@ktb/tenant/TenantDirectory",
) {}

/** The resolution pipeline the composition root binds: selector
 * transport → membership lookup → fallback policy. */
export interface TenantResolverShape {
	readonly resolve: (
		selector: TenantSelector | null | undefined,
		userId: string | null,
	) => Effect.Effect<Tenant | null, unknown>;
}

/**
 * Tenant resolver — a `Context.Reference` (like `Principal`) so `runAs`
 * can consult it unconditionally: apps that never provide one get the
 * default resolver, which resolves `null` (personal scope) and keeps
 * `runAs` backward compatible. Apps opt in by providing their own
 * implementation — typically built with {@link makeTenantResolver} or
 * {@link TenantResolverLive} — at the composition root.
 */
export const TenantResolver = Context.Reference<TenantResolverShape>("@ktb/tenant/TenantResolver", {
	defaultValue: () => ({ resolve: () => Effect.succeed(null) }),
});

/** No-selector fallback policy. `"personal"` resolves `null` (personal
 * scope — the historical behavior); `"deny"` fails `TenantRequired` for
 * apps where every request must name a tenant. */
export type TenantFallback = "personal" | "deny";

export interface MakeTenantResolverOptions {
	readonly directory: TenantDirectoryShape;
	/** Policy when no selector is supplied. Default `"personal"`. */
	readonly fallback?: TenantFallback;
	/** Optional default pick from the user's memberships when no
	 * selector is given (e.g. auto-select the user's only clinic).
	 * Returning `null`/`undefined` falls through to `fallback`. Runs
	 * before the fallback policy and only for authenticated users. */
	readonly selectDefault?: (
		memberships: readonly TenantMembership[],
	) => Tenant | TenantMembership | null | undefined;
}

const toTenant = (picked: Tenant | TenantMembership): Tenant =>
	"tenant" in picked ? { ...picked.tenant, role: picked.role } : picked;

/**
 * Build a {@link TenantResolverShape} from a directory plus fallback
 * policy — the standard resolution pipeline:
 *
 * 1. Empty selector → `selectDefault` pick, else `fallback`
 *    (`"personal"` → `null`, `"deny"` → `TenantRequired`).
 * 2. Selector present but no user (system context) → `TenantNotFound`.
 * 3. `directory.findBySelector` → `Tenant`, or `TenantNotFound` when the
 *    selector matches nothing the user can access.
 */
export const makeTenantResolver = (options: MakeTenantResolverOptions): TenantResolverShape => ({
	resolve: (selector, userId) =>
		Effect.gen(function* () {
			if (isEmptySelector(selector)) {
				if (options.selectDefault !== undefined && userId !== null) {
					const memberships = yield* options.directory.membershipsFor(userId);
					const picked = options.selectDefault(memberships);
					if (picked !== null && picked !== undefined) return toTenant(picked);
				}
				if (options.fallback === "deny") {
					return yield* Effect.fail(new TenantRequired({ reason: "no tenant selected" }));
				}
				return null;
			}
			if (userId === null) {
				return yield* Effect.fail(new TenantNotFound({ selector: selector ?? {} }));
			}
			const tenant = yield* options.directory.findBySelector(userId, selector as TenantSelector);
			if (tenant === null) {
				return yield* Effect.fail(new TenantNotFound({ selector: selector as TenantSelector }));
			}
			return tenant;
		}),
});

/**
 * Layer variant of {@link makeTenantResolver}: resolves `TenantDirectory`
 * from the environment, so apps provide the directory as a service and
 * mount this layer (or pass the built shape to `createApp`'s tenant
 * option) at the composition root.
 */
export const TenantResolverLive = (options: Omit<MakeTenantResolverOptions, "directory">) =>
	Layer.effect(
		TenantResolver,
		Effect.map(TenantDirectory, (directory) => makeTenantResolver({ ...options, directory })),
	);

export {
	accessibleTenantIds,
	scopedRepo,
	tenantScopeCondition,
	type ScopedRepo,
	type ScopedRows,
	type TenantScopedTable,
} from "./scoped-repo.ts";
export {
	TENANT_ROLE_RANK,
	TenantForbidden,
	requireTenantRole,
	tenantAuthz,
	tenantRoleAtLeast,
	type RoleActionMatrix,
	type RoleGrantNode,
	type TenantRoleGrant,
} from "./authz.ts";
export {
	applyTenantRls,
	tenantRlsStatements,
	type TenantRlsOptions,
	type TenantRlsResult,
	type TenantRlsTable,
	type TenantSqlDialect,
} from "./rls.ts";
export { tenantIdColumn, tenantTable } from "./schema.ts";

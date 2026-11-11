import type { Definition, Rules } from "permix";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { Tenant, type TenantRole } from "./context.ts";

/**
 * Tenant-aware authorization (P-053): builds permix {@link Rules} from an
 * app-supplied role→action matrix. The package owns the role semantics
 * (owner > admin > member) and the deny behavior; apps own the matrix —
 * which actions each tenant role may perform on which entities.
 *
 * Composes with dynamic RBAC (P-054): tenant role gates first (this
 * layer), fine-grained grants second.
 */

/** Role ranking — higher outranks lower. */
export const TENANT_ROLE_RANK: Record<TenantRole, number> = {
	member: 1,
	admin: 2,
	owner: 3,
};

/** True when `role` exists and ranks at or above `min`. */
export const tenantRoleAtLeast = (role: TenantRole | null, min: TenantRole): boolean =>
	role !== null && TENANT_ROLE_RANK[role] >= TENANT_ROLE_RANK[min];

/** A single matrix leaf: either a minimum role (`"admin"` = admin and
 * above, i.e. admin+owner), a list of minimum roles (lowest wins —
 * `["member","owner"]` still means member-and-above), or a predicate
 * receiving `(role, data)` for data-dependent grants. */
export type TenantRoleGrant =
	| TenantRole
	| readonly TenantRole[]
	| ((role: TenantRole, data: unknown) => boolean);

/** Matrix node: a grant leaf or a nested entity/action map mirroring
 * the permix `Definition` shape. */
export type RoleGrantNode = TenantRoleGrant | { readonly [key: string]: RoleGrantNode };

/** App-supplied role→action matrix, e.g.
 * `{ patient: { read: "member", delete: "owner" } }`. */
export interface RoleActionMatrix {
	readonly [entity: string]: RoleGrantNode;
}

const isGrant = (node: RoleGrantNode): node is TenantRoleGrant =>
	typeof node === "string" || typeof node === "function" || Array.isArray(node);

const minRankOf = (grant: TenantRole | readonly TenantRole[]): number =>
	Math.min(
		...((Array.isArray(grant) ? grant : [grant]) as readonly TenantRole[]).map(
			(r) => TENANT_ROLE_RANK[r],
		),
	);

const buildNode = (node: RoleGrantNode, role: TenantRole | null): unknown => {
	if (isGrant(node)) {
		if (role === null) return false;
		if (typeof node === "function") return (data: unknown) => node(role, data);
		return TENANT_ROLE_RANK[role] >= minRankOf(node);
	}
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(node)) {
		out[key] = buildNode(child, role);
	}
	return out;
};

/**
 * Build permix rules for a tenant role from the app's matrix. Feed the
 * result to the app's permix `layer(...)`/`authzLayer(...)` — typically
 * inside the request scope where `Tenant` is bound:
 *
 * ```ts
 * const rules = tenantAuthz<MyDef>(matrix)(tenant?.role ?? null);
 * ```
 *
 * A `null` role (personal scope / system context) denies every
 * tenant-gated action — personal data stays governed by the app's
 * owner-based rules, not by this matrix.
 */
export const tenantAuthz =
	<D extends Definition>(matrix: RoleActionMatrix) =>
	(role: TenantRole | null): Rules<D> =>
		buildNode(matrix, role) as Rules<D>;

/** Denial error for tenant-role assertions — the tenant counterpart of
 * authz's `Forbidden`. */
export class TenantForbidden extends Data.TaggedError("TenantForbidden")<{
	readonly path: string;
	readonly role: TenantRole | null;
	readonly required: TenantRole;
}> {}

/**
 * Assert the bound `Tenant`'s role ranks at or above `min` — for guards
 * that don't go through permix (e.g. "only an owner may delete the
 * tenant"). Fails `TenantForbidden` in personal scope or on
 * insufficient rank; `TenantRequired` never fires here — a missing
 * tenant is a `TenantForbidden` with `role: null`.
 */
export const requireTenantRole = (min: TenantRole, path = "tenant") =>
	Effect.flatMap(Tenant, (tenant) =>
		tenant !== null && tenantRoleAtLeast(tenant.role, min)
			? Effect.void
			: Effect.fail(
					new TenantForbidden({
						path,
						role: tenant?.role ?? null,
						required: min,
					}),
				),
	);

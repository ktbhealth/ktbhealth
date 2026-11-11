/**
 * Tenant selector transport helpers (P-053) — dependency-free on
 * purpose: `@ktb/server-fns` session helpers import this subpath, and
 * that module is reachable from client bundles through plugin index
 * files, so it must not pull in `@ktb/db`/drizzle/effect.
 */

/**
 * Opaque tenant selector extracted by the route layer from the request
 * (header, subdomain, session-persisted choice — transport is the app's
 * choice). The `TenantDirectory` port interprets it; the package only
 * guarantees the shape travels intact into `TenantResolver.resolve`.
 */
export interface TenantSelector {
	readonly id?: string | number;
	readonly slug?: string;
	readonly kind?: string;
	/** Escape hatch for app-specific selector data (raw header value,
	 * subdomain label, …). */
	readonly raw?: unknown;
}

/** True when the selector carries no signal — resolution falls back to
 * the configured default policy instead of hitting the directory. */
export const isEmptySelector = (selector: TenantSelector | null | undefined): boolean =>
	selector === null ||
	selector === undefined ||
	(selector.id === undefined &&
		selector.slug === undefined &&
		selector.kind === undefined &&
		selector.raw === undefined);

/** Header names read by {@link tenantSelectorFromHeaders}. */
export const TENANT_SELECTOR_HEADERS = {
	id: "x-tenant-id",
	slug: "x-tenant-slug",
	kind: "x-tenant-kind",
	raw: "x-tenant",
} as const;

/**
 * Extract a {@link TenantSelector} from request headers — the default
 * header transport (`x-tenant-id` / `x-tenant-slug` / `x-tenant-kind` /
 * `x-tenant` raw). Returns `null` when no tenant header is present, so
 * callers can pass the result straight into `runAs`.
 */
export const tenantSelectorFromHeaders = (headers: Headers): TenantSelector | null => {
	const id = headers.get(TENANT_SELECTOR_HEADERS.id);
	const slug = headers.get(TENANT_SELECTOR_HEADERS.slug);
	const kind = headers.get(TENANT_SELECTOR_HEADERS.kind);
	const raw = headers.get(TENANT_SELECTOR_HEADERS.raw);
	if (id === null && slug === null && kind === null && raw === null) return null;
	const selector: {
		id?: string | number;
		slug?: string;
		kind?: string;
		raw?: unknown;
	} = {};
	if (id !== null) selector.id = /^-?\d+$/.test(id) ? Number(id) : id;
	if (slug !== null) selector.slug = slug;
	if (kind !== null) selector.kind = kind;
	if (raw !== null) selector.raw = raw;
	return selector;
};

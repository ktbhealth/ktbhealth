import { Auth } from "@ktb/auth";
import type { SessionUser } from "@ktb/auth";
import { tenantSelectorFromHeaders, type TenantSelector } from "@ktb/tenant/selector";
import * as Effect from "effect/Effect";

import { run } from "./runtime.ts";

export type { SessionUser };

/**
 * Thrown by `ensureSessionUser` when no session exists. The `status`
 * field is read by TanStack Start's error serializer
 * (`getErrorStatus` → `error.status`), so server-fn callers get a real
 * 401 instead of a generic 500. Keep the message stable — callers and
 * tests match on "unauthenticated".
 */
export class UnauthenticatedError extends Error {
	readonly status = 401;
	constructor() {
		super("unauthenticated");
		this.name = "UnauthenticatedError";
	}
}

/**
 * Session helpers for plugin server functions — the same contract the
 * host's `lib/auth.ts` wrappers had, reached through the runtime
 * registry instead of the app's platform module (P-033).
 */
export async function getSessionUser(headers?: Headers): Promise<SessionUser | null> {
	// Lazy: `@tanstack/react-start/server` is server-only and its graph
	// reaches react-dom/server (CJS). This module is reachable from client
	// bundles through plugin index files, so a static import would break
	// hydration; the dynamic import only resolves where it is invoked.
	const requestHeaders =
		headers ?? (await import("@tanstack/react-start/server")).getRequestHeaders();
	const session = await run(
		Effect.gen(function* () {
			const auth = yield* Auth;
			// Auth.getSession is a Promise port; the span wraps the Effect
			// boundary where it is invoked. null session is normal — no logging.
			return yield* Effect.withSpan(
				Effect.promise(() => auth.getSession(requestHeaders)),
				"Auth.getSession",
			);
		}),
	);
	if (!session) return null;
	return session.user;
}

export async function ensureSessionUser(headers?: Headers): Promise<SessionUser> {
	const user = await getSessionUser(headers);
	if (!user) throw new UnauthenticatedError();
	return user;
}

/**
 * Tenant selector for the current request (P-053): reads the default
 * header transport (`x-tenant-id`/`x-tenant-slug`/`x-tenant-kind`/
 * `x-tenant`) via `tenantSelectorFromHeaders`. Pass the result as the
 * third argument to `runAs` so the composition root's TenantResolver
 * binds `Tenant` inside the request scope. Returns `null` when no
 * tenant header is present.
 */
export async function getTenantSelector(headers?: Headers): Promise<TenantSelector | null> {
	// Same lazy server-only import as getSessionUser — this module is
	// reachable from client bundles through plugin index files.
	const requestHeaders =
		headers ?? (await import("@tanstack/react-start/server")).getRequestHeaders();
	return tenantSelectorFromHeaders(requestHeaders);
}

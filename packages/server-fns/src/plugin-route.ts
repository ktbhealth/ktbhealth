import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { peekServerRuntime } from "./runtime.ts";

/**
 * Plugin route gating (P-058): route modules under a plugin's `src/routes`
 * tree build their `Route` through `createPluginFileRoute` instead of bare
 * `createFileRoute`, so a disabled plugin's pages 404 automatically —
 * no per-loader `PluginStates.isEnabled` opt-in.
 *
 * The gate id is the package's `*.routes` plugin id (e.g.
 * `"patients.routes"`): disabling it kills the pages while the package's
 * services/API contributions stay live. Pass the id explicitly at each
 * call site — there is no per-package constant to keep in sync.
 *
 * `pluginEnabledFn` is a server fn, so the check is isomorphic: during
 * SSR it runs inline; on client-side navigation it round-trips to the
 * server. When no runtime (or no `pluginEnabled` capability) is
 * registered — unit tests, scripts — the gate is inert and the route
 * behaves exactly like a bare `createFileRoute`.
 */

const decodePluginId = Schema.decodeUnknownSync(Schema.String);

/**
 * Shared enabled-state check behind both gates. Fails OPEN only when the
 * `pluginEnabled` capability is absent (see module doc) — there is no
 * plugin_state store to consult outside the app runtime anyway.
 */
const isPluginEnabled = async (pluginId: string): Promise<boolean> => {
	const check = peekServerRuntime()?.pluginEnabled;
	if (check === undefined) return true;
	return check(pluginId);
};

/** Server fn backing the route gate: is `pluginId` enabled right now? */
export const pluginEnabledFn = createServerFn({ method: "GET" })
	.validator((pluginId: unknown) => decodePluginId(pluginId))
	.handler(async ({ data: pluginId }) => isPluginEnabled(pluginId));

type BeforeLoad = (ctx: unknown) => unknown;

/** Prepend the enabled-state gate to a route's own `beforeLoad`. */
const withPluginGate = (
	options: { readonly beforeLoad?: unknown } | undefined,
	gate: () => Promise<void>,
): Record<string, unknown> => {
	const userBeforeLoad = options?.beforeLoad;
	return {
		...options,
		beforeLoad: async (ctx: unknown) => {
			await gate();
			if (typeof userBeforeLoad === "function") {
				return (userBeforeLoad as BeforeLoad)(ctx);
			}
			return undefined;
		},
	};
};

/**
 * Drop-in `createFileRoute` replacement for plugin page routes:
 *
 *   export const Route = createPluginFileRoute("patients.routes")(
 *   	"/patients/",
 *   )({ beforeLoad: () => requireSession(), ... });
 *
 * The declared type IS `typeof createFileRoute`, so path literals keep
 * resolving through `FileRoutesByPath` and loader-data inference is
 * unchanged; only the runtime options are wrapped (the enabled-state
 * gate runs before the route's own `beforeLoad`, throwing `notFound()`
 * when the plugin is disabled).
 */
export const createPluginFileRoute = (pluginId: string): typeof createFileRoute => {
	const gate = async (): Promise<void> => {
		const enabled = await pluginEnabledFn({ data: pluginId });
		if (!enabled) throw notFound();
	};
	return ((path?: string) => {
		const create = (createFileRoute as (p?: string) => (o?: unknown) => unknown)(path);
		return (options?: { readonly beforeLoad?: unknown }) => create(withPluginGate(options, gate));
	}) as typeof createFileRoute;
};

// --- API/server routes ------------------------------------------------------
// `server.handlers` routes never run beforeLoad/loaders — the server
// dispatches straight to the method handler (see handleServerRoutes in
// @tanstack/start-server-core), so the page gate cannot apply. Instead
// `createPluginApiRoute` wraps each declared handler: when the plugin is
// disabled it answers `404 {"error":"not found"}` before the handler
// runs. 404 (not 403) matches both the page gate's notFound() semantics
// and these endpoints' existing convention of answering 404 for
// missing/foreign resources — a disabled plugin's API surface should be
// indistinguishable from absent.
//
// The check reads `ServerRuntime.pluginEnabled` directly rather than
// round-tripping through `pluginEnabledFn`: handlers only ever execute
// server-side, so the isomorphic server-fn hop buys nothing.

type ServerHandlerArgs = { readonly request: Request; readonly params: unknown };
type ServerHandler = (args: ServerHandlerArgs) => Promise<Response> | Response;
type ServerHandlerEntry =
	| ServerHandler
	| { readonly handler?: ServerHandler; readonly middleware?: unknown };
type ServerHandlers = Record<string, ServerHandlerEntry>;

/** Wrap one handler entry (bare fn or `{ middleware, handler }` object). */
const wrapHandlerEntry = (
	entry: ServerHandlerEntry,
	gate: () => Promise<Response | undefined>,
): ServerHandlerEntry => {
	if (typeof entry === "function") {
		return async (args: ServerHandlerArgs) => (await gate()) ?? entry(args);
	}
	if (entry !== null && typeof entry === "object" && typeof entry.handler === "function") {
		const inner = entry.handler;
		return {
			...entry,
			handler: async (args: ServerHandlerArgs) => (await gate()) ?? inner(args),
		};
	}
	return entry;
};

const wrapHandlersMap = (
	handlers: ServerHandlers,
	gate: () => Promise<Response | undefined>,
): ServerHandlers => {
	const wrapped: Record<string, ServerHandlerEntry> = {};
	for (const [method, entry] of Object.entries(handlers)) {
		wrapped[method] = wrapHandlerEntry(entry, gate);
	}
	return wrapped;
};

/** Wrap `server.handlers` — supports both the map form and the
 * `({ createHandlers }) => map` factory form. */
const wrapServerHandlers = (
	handlers: ServerHandlers | ((opts: unknown) => ServerHandlers),
	gate: () => Promise<Response | undefined>,
): ServerHandlers | ((opts: unknown) => ServerHandlers) => {
	if (typeof handlers === "function") {
		return (opts: unknown) => wrapHandlersMap(handlers(opts), gate);
	}
	return wrapHandlersMap(handlers, gate);
};

/** Prepend the enabled-state gate to a server route's `server.handlers`. */
const withApiGate = (
	options: { readonly server?: { readonly handlers?: unknown } } | undefined,
	gate: () => Promise<Response | undefined>,
): Record<string, unknown> => {
	const server = options?.server;
	const handlers = server?.handlers;
	if (server === undefined || handlers === undefined) return { ...options };
	return {
		...options,
		server: {
			...server,
			handlers: wrapServerHandlers(
				handlers as ServerHandlers | ((opts: unknown) => ServerHandlers),
				gate,
			),
		},
	};
};

/**
 * Drop-in `createFileRoute` replacement for plugin API/server routes
 * (the `src/api-routes` tree of each plugin):
 *
 *   export const Route = createPluginApiRoute("notifications.routes")(
 *   "/api/notifications",
 *   )({ server: { handlers: { GET: ... } } });
 *
 * Same declared type as `createFileRoute`; only `server.handlers` is
 * wrapped — every method first awaits the enabled-state check and
 * answers 404 when the plugin is off, otherwise delegates untouched.
 * Routes without `server.handlers` pass through unchanged.
 */
export const createPluginApiRoute = (pluginId: string): typeof createFileRoute => {
	const gate = async (): Promise<Response | undefined> => {
		if (await isPluginEnabled(pluginId)) return undefined;
		return Response.json({ error: "not found" }, { status: 404 });
	};
	return ((path?: string) => {
		const create = (createFileRoute as (p?: string) => (o?: unknown) => unknown)(path);
		return (options?: { readonly server?: { readonly handlers?: unknown } }) =>
			create(withApiGate(options, gate));
	}) as typeof createFileRoute;
};

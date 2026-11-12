import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";

// Server fns become plain async calls; the runtime registry decides the
// enabled answer (see setServerRuntime cases below).
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((value: unknown) => unknown) | undefined;
		const api = {
			validator: (fn: (value: unknown) => unknown) => {
				validate = fn;
				return api;
			},
			handler: (h: (arg: { data: unknown }) => unknown) => async (call: { data?: unknown }) =>
				h({ data: validate === undefined ? call?.data : validate(call?.data) }),
		};
		return api;
	},
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
		notFound: () => Object.assign(new Error("not-found"), { isNotFound: true }),
	};
});

import {
	createPluginApiRoute,
	createPluginFileRoute,
	pluginEnabledFn,
	resetServerRuntime,
	setServerRuntime,
	type ServerRuntime,
} from "./index.ts";

const runPromise = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
	Effect.runPromise(effect as Effect.Effect<A, E, never>);

const stubRuntime = (pluginEnabled?: (pluginId: string) => Promise<boolean>): ServerRuntime => ({
	run: runPromise,
	runAs: (_user, effect) => runPromise(effect),
	getLocale: () => "en",
	audioTranscribeModel: "test-model",
	pluginEnabled,
});

// The declared type is `typeof createFileRoute` for real call sites;
// this package's own program has no FileRoutesByPath augmentation, so
// tests widen the signature back to plain strings/options.
const createRoute = createPluginFileRoute as unknown as (
	pluginId: string,
) => (path: string) => (options?: Record<string, unknown>) => { options: Record<string, unknown> };

const beforeLoadOf = (route: { options: Record<string, unknown> }) =>
	route.options.beforeLoad as (ctx: unknown) => Promise<unknown>;

beforeEach(() => {
	resetServerRuntime();
});

describe("pluginEnabledFn", () => {
	it("returns true when no runtime is registered (inert outside the app)", async () => {
		await expect(pluginEnabledFn({ data: "demo.routes" })).resolves.toBe(true);
	});

	it("delegates to the runtime's pluginEnabled capability", async () => {
		setServerRuntime(stubRuntime(async (id) => id !== "demo.routes"));
		await expect(pluginEnabledFn({ data: "demo.routes" })).resolves.toBe(false);
		await expect(pluginEnabledFn({ data: "other.routes" })).resolves.toBe(true);
	});
});

describe("createPluginFileRoute", () => {
	it("runs the route's own beforeLoad when the plugin is enabled", async () => {
		setServerRuntime(stubRuntime(async () => true));
		const userBeforeLoad = vi.fn(async () => "ctx-result");
		const route = createRoute("demo.routes")("/demo")({ beforeLoad: userBeforeLoad });
		const ctx = { params: {} };
		await expect(beforeLoadOf(route)(ctx)).resolves.toBe("ctx-result");
		expect(userBeforeLoad).toHaveBeenCalledWith(ctx);
	});

	it("throws notFound and skips beforeLoad when the plugin is disabled", async () => {
		setServerRuntime(stubRuntime(async () => false));
		const userBeforeLoad = vi.fn();
		const route = createRoute("demo.routes")("/demo")({ beforeLoad: userBeforeLoad });
		await expect(beforeLoadOf(route)({})).rejects.toMatchObject({ isNotFound: true });
		expect(userBeforeLoad).not.toHaveBeenCalled();
	});

	it("gates per plugin id", async () => {
		setServerRuntime(stubRuntime(async (id) => id === "on.routes"));
		const on = createRoute("on.routes")("/on")({});
		const off = createRoute("off.routes")("/off")({});
		await expect(beforeLoadOf(on)({})).resolves.toBeUndefined();
		await expect(beforeLoadOf(off)({})).rejects.toMatchObject({ isNotFound: true });
	});

	it("injects a gate even when the route declares no beforeLoad", async () => {
		setServerRuntime(stubRuntime(async () => false));
		const route = createRoute("demo.routes")("/demo")({ loader: () => null });
		await expect(beforeLoadOf(route)({})).rejects.toMatchObject({ isNotFound: true });
	});

	it("is inert when the runtime has no pluginEnabled capability", async () => {
		setServerRuntime(stubRuntime());
		const userBeforeLoad = vi.fn(async () => "ok");
		const route = createRoute("demo.routes")("/demo")({ beforeLoad: userBeforeLoad });
		await expect(beforeLoadOf(route)({})).resolves.toBe("ok");
	});
});

// Same widening as createRoute: the declared type is `typeof
// createFileRoute`; tests treat options as a plain record.
const createApiRoute = createPluginApiRoute as unknown as (pluginId: string) => (path: string) => (
	options?: Record<string, unknown>,
) => {
	options: Record<string, unknown>;
};

type HandlerFn = (args: { request: Request; params: unknown }) => Promise<Response>;
type HandlerEntry = HandlerFn | { handler: HandlerFn; middleware?: unknown };
const handlersOf = (route: { options: Record<string, unknown> }) =>
	(route.options.server as { handlers: Record<string, HandlerEntry> }).handlers;
const call = (entry: HandlerEntry, args = { request: new Request("http://x/"), params: {} }) =>
	typeof entry === "function" ? entry(args) : entry.handler(args);

describe("createPluginApiRoute", () => {
	it("answers 404 for every method and skips the handlers when disabled", async () => {
		setServerRuntime(stubRuntime(async () => false));
		const get = vi.fn(async () => new Response("inner"));
		const post = vi.fn(async () => new Response("inner"));
		const route = createApiRoute("demo.routes")("/api/demo")({
			server: { handlers: { GET: get, POST: post } },
		});
		const handlers = handlersOf(route);
		for (const res of [await call(handlers.GET!), await call(handlers.POST!)]) {
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: "not found" });
		}
		expect(get).not.toHaveBeenCalled();
		expect(post).not.toHaveBeenCalled();
	});

	it("delegates to the handlers untouched when enabled", async () => {
		setServerRuntime(stubRuntime(async () => true));
		const inner = new Response("ok", { status: 201 });
		const get = vi.fn(async () => inner);
		const route = createApiRoute("demo.routes")("/api/demo")({
			server: { handlers: { GET: get } },
		});
		const args = { request: new Request("http://x/api/demo"), params: { id: "1" } };
		await expect(call(handlersOf(route).GET!, args)).resolves.toBe(inner);
		expect(get).toHaveBeenCalledWith(args);
	});

	it("wraps the handler inside { middleware, handler } entries and keeps middleware", async () => {
		setServerRuntime(stubRuntime(async (id) => id !== "demo.routes"));
		const middleware = vi.fn();
		const inner = vi.fn(async () => new Response("inner"));
		const route = createApiRoute("demo.routes")("/api/demo")({
			server: { handlers: { GET: { middleware: [middleware], handler: inner } } },
		});
		const entry = handlersOf(route).GET! as { handler: HandlerFn; middleware: unknown[] };
		expect(entry.middleware).toEqual([middleware]);
		const res = await entry.handler({ request: new Request("http://x/"), params: {} });
		expect(res.status).toBe(404);
		expect(inner).not.toHaveBeenCalled();
	});

	it("delegates inside { middleware, handler } entries when enabled", async () => {
		setServerRuntime(stubRuntime(async () => true));
		const middleware = vi.fn();
		const inner = vi.fn(async () => new Response("inner", { status: 202 }));
		const route = createApiRoute("demo.routes")("/api/demo")({
			server: { handlers: { GET: { middleware: [middleware], handler: inner } } },
		});
		const entry = handlersOf(route).GET! as { handler: HandlerFn; middleware: unknown[] };
		expect(entry.middleware).toEqual([middleware]);
		const args = { request: new Request("http://x/"), params: {} };
		const res = await entry.handler(args);
		expect(res.status).toBe(202);
		expect(inner).toHaveBeenCalledWith(args);
	});

	it("supports the ({ createHandlers }) => handlers factory form", async () => {
		setServerRuntime(stubRuntime(async () => false));
		const inner = vi.fn(async () => new Response("inner"));
		const route = createApiRoute("demo.routes")("/api/demo")({
			server: {
				handlers: ({ createHandlers }: { createHandlers: (d: unknown) => unknown }) =>
					createHandlers({ GET: inner }) as Record<string, HandlerEntry>,
			},
		});
		const handlers = route.options.server as {
			handlers: (o: unknown) => Record<string, HandlerEntry>;
		};
		const res = await call(handlers.handlers({ createHandlers: (d: unknown) => d }).GET!);
		expect(res.status).toBe(404);
		expect(inner).not.toHaveBeenCalled();
	});

	it("gates per plugin id", async () => {
		setServerRuntime(stubRuntime(async (id) => id === "on.routes"));
		const inner = vi.fn(async () => new Response("ok"));
		const on = createApiRoute("on.routes")("/api/on")({
			server: { handlers: { GET: inner } },
		});
		const off = createApiRoute("off.routes")("/api/off")({
			server: { handlers: { GET: inner } },
		});
		await expect(call(handlersOf(on).GET!)).resolves.toMatchObject({ status: 200 });
		await expect(call(handlersOf(off).GET!)).resolves.toMatchObject({ status: 404 });
		expect(inner).toHaveBeenCalledTimes(1);
	});

	it("leaves non-handler entries (e.g. middleware-only objects) untouched", async () => {
		setServerRuntime(stubRuntime(async () => false));
		const entry = { middleware: [vi.fn()] };
		const route = createApiRoute("demo.routes")("/api/demo")({
			server: { handlers: { GET: entry } },
		});
		expect(handlersOf(route).GET).toBe(entry);
	});

	it("passes routes without server.handlers through unchanged", async () => {
		setServerRuntime(stubRuntime(async () => false));
		const route = createApiRoute("demo.routes")("/api/demo")({ component: () => null });
		expect(route.options.server).toBeUndefined();
	});

	it("is inert when the runtime has no pluginEnabled capability", async () => {
		setServerRuntime(stubRuntime());
		const inner = vi.fn(async () => new Response("ok"));
		const route = createApiRoute("demo.routes")("/api/demo")({
			server: { handlers: { GET: inner } },
		});
		await expect(call(handlersOf(route).GET!)).resolves.toMatchObject({ status: 200 });
		expect(inner).toHaveBeenCalledOnce();
	});
});

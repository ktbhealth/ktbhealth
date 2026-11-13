import { describe, expect, it, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";

import { PluginStates } from "@ktb/platform/plugin-states";
import { PlatformAdmin } from "@ktb/platform";
import { Telemetry, type TelemetryShape } from "@ktb/observability";
import { env } from "cloudflare:workers";

const mocks = vi.hoisted(() => ({
	run: vi.fn(),
	getSessionUser: vi.fn(),
}));

vi.mock("#/lib/platform.ts", async (importOriginal) => {
	const m = await importOriginal<typeof import("#/lib/platform.ts")>();
	return { ...m, run: mocks.run };
});
vi.mock("#/lib/auth.ts", async (importOriginal) => {
	const m = await importOriginal<typeof import("#/lib/auth.ts")>();
	return { ...m, getSessionUser: mocks.getSessionUser };
});

import { Route as TelemetryRoute } from "./telemetry.ts";
import { Route as HealthRoute } from "./health.ts";
import { Route as ReadyRoute } from "./ready.ts";
import { Route as MetricsRoute } from "./metrics.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

const telemetry = {
	ingest: () => Effect.void,
	flush: Effect.void,
	scrape: Effect.succeed("ktb_test_metric 1\n"),
	health: Effect.succeed({ logs: "console", traces: "off", metrics: "prometheus" }),
} as unknown as TelemetryShape;

/** Run the route's Effect with just the services it yields — the mocked
 * `run` executes it against test doubles instead of the app runtime. */
const runWith =
	(...services: Array<readonly [never, unknown]>) =>
	(effect: Effect.Effect<unknown, unknown, never>) =>
		Effect.runPromise(
			services.reduce(
				(acc, [tag, value]) => Effect.provideService(acc, tag, value),
				effect as Effect.Effect<unknown, unknown, never>,
			),
		);

const post = (body: string) =>
	new Request("http://localhost/api/telemetry", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});

describe("observability api routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSessionUser.mockResolvedValue(null);
		delete (env as unknown as Record<string, unknown>).METRICS_SCRAPE_TOKEN;
	});

	describe("POST /api/telemetry", () => {
		it("accepts a valid batch with 204", async () => {
			mocks.run.mockImplementation(runWith([Telemetry as never, telemetry]));
			const res = await handlersOf(TelemetryRoute).POST!({
				request: post(JSON.stringify({ events: [{ type: "event", name: "x" }] })),
			} as never);
			expect(res.status).toBe(204);
		});

		it("rejects schema-invalid payloads with 400", async () => {
			const res = await handlersOf(TelemetryRoute).POST!({
				request: post(JSON.stringify({ events: "nope" })),
			} as never);
			expect(res.status).toBe(400);
			expect(mocks.run).not.toHaveBeenCalled();
		});

		it("rejects malformed JSON with 400", async () => {
			const res = await handlersOf(TelemetryRoute).POST!({
				request: post("{not json"),
			} as never);
			expect(res.status).toBe(400);
		});

		it("rejects non-POST methods with 405", async () => {
			const res = await handlersOf(TelemetryRoute).GET!({} as never);
			expect(res.status).toBe(405);
		});
	});

	describe("GET /api/health", () => {
		it("reports ok", async () => {
			const res = await handlersOf(HealthRoute).GET!({} as never);
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ status: "ok" });
		});
	});

	describe("GET /api/ready", () => {
		it("reports ready with telemetry health when dependencies respond", async () => {
			mocks.run.mockImplementation(
				runWith(
					[PluginStates as never, { enabledIds: () => Effect.succeed(new Set()) }],
					[Telemetry as never, telemetry],
				),
			);
			const res = await handlersOf(ReadyRoute).GET!({} as never);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { status: string; telemetry: unknown };
			expect(body.status).toBe("ready");
			expect(body.telemetry).toEqual({
				logs: "console",
				traces: "off",
				metrics: "prometheus",
			});
		});

		it("reports unavailable when the datastore probe fails", async () => {
			mocks.run.mockImplementation(
				runWith([PluginStates as never, { enabledIds: () => Effect.fail(new Error("db down")) }]),
			);
			const res = await handlersOf(ReadyRoute).GET!({} as never);
			expect(res.status).toBe(503);
		});
	});

	describe("GET /api/metrics", () => {
		const get = (authorization?: string) =>
			handlersOf(MetricsRoute).GET!({
				request: new Request("http://localhost/api/metrics", {
					headers: authorization === undefined ? {} : { authorization },
				}),
			} as never);

		it("serves prometheus text to a valid scrape token", async () => {
			(env as unknown as Record<string, unknown>).METRICS_SCRAPE_TOKEN = "scrape-secret";
			mocks.run.mockImplementation(runWith([Telemetry as never, telemetry]));
			const res = await get("Bearer scrape-secret");
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/plain");
			await expect(res.text()).resolves.toContain("ktb_test_metric");
		});

		it("rejects wrong or missing credentials for anonymous callers", async () => {
			(env as unknown as Record<string, unknown>).METRICS_SCRAPE_TOKEN = "scrape-secret";
			expect((await get()).status).toBe(403);
			expect((await get("Bearer wrong")).status).toBe(403);
		});

		it("treats an empty scrape token as unset", async () => {
			(env as unknown as Record<string, unknown>).METRICS_SCRAPE_TOKEN = "";
			expect((await get("Bearer ")).status).toBe(403);
		});

		it("serves platform admins without a token", async () => {
			mocks.getSessionUser.mockResolvedValue({ id: "u1", email: "platform-admin@ktb.test" });
			mocks.run.mockImplementation(
				runWith(
					[PlatformAdmin as never, { isAdmin: () => Effect.succeed(true) }],
					[Telemetry as never, telemetry],
				),
			);
			const res = await get();
			expect(res.status).toBe(200);
		});

		it("denies non-admin users and admin-check failures", async () => {
			mocks.getSessionUser.mockResolvedValue({ id: "u1", email: "user@x.com" });
			mocks.run.mockImplementation(
				runWith([PlatformAdmin as never, { isAdmin: () => Effect.succeed(false) }]),
			);
			expect((await get()).status).toBe(403);
			// isAdmin failure → catch → treated as non-admin.
			mocks.run.mockImplementation(
				runWith([PlatformAdmin as never, { isAdmin: () => Effect.fail(new Error("x")) }]),
			);
			expect((await get()).status).toBe(403);
		});
	});
});

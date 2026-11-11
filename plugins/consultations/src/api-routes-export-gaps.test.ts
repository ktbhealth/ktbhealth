import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { Auth } from "@ktb/auth";
import { Principal } from "@ktb/authz";
import { resetServerRuntime, setServerRuntime } from "@ktb/server-fns";

import { Route as ExportRoute } from "./api-routes/patients.$id.export.ts";

// The host publishes record exporters on the server runtime. When a format
// has no exporter registered the route must answer 503 (not 404/500).

const authStub = Auth.of({
	getSession: async (h: Headers) =>
		/session=owner/.test(h.get("cookie") ?? "")
			? {
					user: { id: "u-owner", email: "export@x.com", name: "Dra Export" },
					sessionId: "sess-owner",
					expiresAt: new Date(Date.now() + 3_600_000),
				}
			: null,
});

const runtime = ManagedRuntime.make(Layer.succeed(Auth, authStub) as Layer.Layer<unknown>);

const get = (url: string) =>
	(
		ExportRoute as unknown as {
			options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } };
		}
	).options.server.handlers.GET!({ request: new Request(url), params: { id: "1" } } as never);

beforeAll(() => {
	setServerRuntime({
		run: (effect) => runtime.runPromise(effect as Effect.Effect<never, never, never>),
		runAs: (user, effect) =>
			runtime.runPromise(
				effect.pipe(
					Effect.provideService(Principal, { userId: user.id, email: user.email }),
				) as Effect.Effect<never, never, never>,
			),
		getLocale: () => "en",
		audioTranscribeModel: "test-model",
	});
});
afterAll(async () => {
	resetServerRuntime();
	await runtime.dispose();
});

describe("GET /api/patients/:id/export without a configured exporter", () => {
	it("answers 503 when the requested format has no exporter registered", async () => {
		headers.current = new Headers({ cookie: "session=owner" });
		const res = await get("http://localhost:3000/api/patients/1/export?format=fhir-r4");
		expect(res.status).toBe(503);
		await expect(res.json()).resolves.toEqual({ error: "export not configured" });
	});
});

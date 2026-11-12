import { beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const chain = {
			validator: () => chain,
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg ?? {}),
		};
		return chain;
	},
}));

let failCreateConsultation = false;
vi.mock("@ktb/consultations", async (importOriginal) => {
	const m = await importOriginal<typeof import("@ktb/consultations")>();
	const { Effect, Layer } = await import("effect");
	// Wrap the real layer so `create` can be forced to fail in tests; the
	// service methods are reached through `run`, not module exports.
	const ConsultationsLive = Layer.effect(
		m.Consultations,
		Effect.gen(function* () {
			const svc = yield* Effect.provide(m.Consultations, m.ConsultationsLive);
			return m.Consultations.of({
				...svc,
				create: (fields: Parameters<typeof svc.create>[0]) =>
					failCreateConsultation ? Effect.succeed(null) : svc.create(fields),
			});
		}),
	);
	return {
		...m,
		ConsultationsLive,
		// app-host composes the discovered `plugins` array, not the named
		// plugin exports — swap the services layer on the matching entry.
		plugins: m.plugins.map((p) =>
			p.id === "consultations.services" ? { ...p, services: ConsultationsLive } : p,
		),
	};
});

import { auth, db } from "#/lib/platform.ts";
import { consultations } from "@ktb/db/schema";
import { eq } from "drizzle-orm";
import { Route as AuthRoute } from "@ktb/auth-plugin/api-route";
import { Route as BotsRoute } from "./bots.ts";
import { Route as WebhookRoute } from "./bots.webhook.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

const post = (url: string, body: unknown) =>
	new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

let cookie = "";
let userId = "";

async function signIn() {
	await auth.api.signUpEmail({
		body: { email: "api@x.com", password: "senha-forte-123", name: "Dra API" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "api@x.com", password: "senha-forte-123" }),
		}),
	);
	cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
	const sess: any = await auth.api.getSession({ headers: new Headers({ cookie }) });
	userId = sess.user.id;
	headers.current = new Headers({ cookie });
}

describe("api routes", () => {
	beforeAll(signIn);

	it("auth catch-all proxies GET and POST", async () => {
		const h = handlersOf(AuthRoute);
		const get = await h.GET!({
			request: new Request("http://localhost:3000/api/auth/get-session", {
				headers: { cookie },
			}),
		} as never);
		expect(get.status).toBe(200);
		const res = await h.POST!({
			request: post("http://localhost:3000/api/auth/sign-in/email", {
				email: "api@x.com",
				password: "senha-forte-123",
			}),
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { user: { email: string } };
		expect(body.user.email).toBe("api@x.com");
	});

	it("bots POST creates a stub consultation", { timeout: 90000 }, async () => {
		const h = handlersOf(BotsRoute);
		const bad = await h.POST!({
			request: post("http://x/api/bots", {}),
		} as never);
		expect(bad.status).toBe(400);

		failCreateConsultation = true;
		const failed = await h.POST!({
			request: post("http://x/api/bots", { meetUrl: "https://meet.google.com/fail-1234" }),
		} as never);
		expect(failed.status).toBe(500);
		failCreateConsultation = false;

		const res = await h.POST!({
			request: post("http://x/api/bots", { meetUrl: "https://meet.google.com/abc-defg-hij" }),
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { consultationId: number; botId: string; provider: string };
		expect(body.provider).toBe("stub");
		expect(body.consultationId).toBeGreaterThan(0);
		// wait for the simulated call to finish appending
		await vi.waitFor(
			async () => {
				const rows = await db
					.select()
					.from(consultations)
					.where(eq(consultations.id, body.consultationId));
				expect(rows[0]?.status).toBe("done");
			},
			// The stub bot appends transcript chunks on a timer — under
			// parallel load the simulated call can take ~60s.
			{ timeout: 60000 },
		);
	});

	it("bots POST refuses the stub provider outside dev", async () => {
		// No RECALL_API_KEY in this suite → the runtime resolves the stub
		// provider; outside dev that must fail loudly instead of simulating.
		vi.stubEnv("DEV", false);
		try {
			const h = handlersOf(BotsRoute);
			const res = await h.POST!({
				request: post("http://x/api/bots", { meetUrl: "https://meet.google.com/prod-1234" }),
			} as never);
			expect(res.status).toBe(503);
			expect(await res.json()).toEqual({ error: "meeting bot is not configured" });
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("bots POST requires auth", async () => {
		headers.current = new Headers();
		const h = handlersOf(BotsRoute);
		await expect(
			h.POST!({ request: post("http://x/api/bots", { meetUrl: "https://m.co/x" }) } as never),
		).rejects.toThrow("unauthenticated");
		headers.current = new Headers({ cookie });
	});

	it("webhook validates, authorizes and appends transcript", async () => {
		const h = handlersOf(WebhookRoute);
		const bad = await h.POST!({
			request: post("http://x/api/bots/webhook", {}),
		} as never);
		expect(bad.status).toBe(400);

		// create a bot consultation directly
		const { createConsultation } = await import("@ktb/consultations");
		const id = await createConsultation(db, {
			userId,
			source: "bot",
			status: "live",
			botId: "bot-123",
		});
		expect(id).toBeGreaterThan(0);

		const forbidden = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "wrong-bot",
				text: "oi",
			}),
		} as never);
		expect(forbidden.status).toBe(403);

		const seg = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "bot-123",
				speaker: "Médico",
				text: "Bom dia",
			}),
		} as never);
		expect(seg.status).toBe(200);

		const noText = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "bot-123",
			}),
		} as never);
		expect(noText.status).toBe(200);

		const noSpeaker = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "bot-123",
				text: "linha sem locutor",
			}),
		} as never);
		expect(noSpeaker.status).toBe(200);

		const end = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "bot-123",
				end: true,
			}),
		} as never);
		expect(end.status).toBe(200);

		const rows = await db.select().from(consultations).where(eq(consultations.id, id));
		expect(rows[0]?.transcript).toContain("Médico: Bom dia");
		expect(rows[0]?.transcript).toContain("linha sem locutor");
		expect(rows[0]?.status).toBe("done");
	});
});

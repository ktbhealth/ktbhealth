import { beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "cloudflare:workers";

const headers = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));

// RECALL_API_KEY must be bound before platform.ts composes the app runtime —
// the Bot driver selects its provider once, at layer build time. Dynamic
// imports keep the binding assignment ahead of module evaluation.
env.RECALL_API_KEY = "recall-key";

const { auth } = await import("#/lib/platform.ts");
const { signUpDoctor } = await import("#/test/doctor.ts");
const { Route: BotsRoute } = await import("./bots.ts");

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

const post = (url: string, body: unknown) =>
	new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

describe("bots route with recall provider", () => {
	beforeAll(async () => {
		await signUpDoctor({ email: "recall@x.com", password: "senha-forte-123", name: "Dra Recall" });
		const res = await auth.handler(
			new Request("http://localhost:3000/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "recall@x.com", password: "senha-forte-123" }),
			}),
		);
		const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
		headers.current = new Headers({ cookie });
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (String(url).includes("api.recall.ai")) {
					return { ok: true, json: async () => ({ id: "recall-bot-1" }) };
				}
				return { ok: true, json: async () => ({}) };
			}),
		);
	});

	it("bots POST uses the recall provider and skips stub simulation", async () => {
		const h = handlersOf(BotsRoute);
		const res = await h.POST!({
			request: post("http://x/api/bots", { meetUrl: "https://meet.google.com/rec-1234" }),
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { consultationId: number; provider: string; botId: string };
		expect(body.provider).toBe("recall");
		expect(body.botId).toBe("recall-bot-1");
		expect(body.consultationId).toBeGreaterThan(0);
	});
});

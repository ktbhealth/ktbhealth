import { describe, expect, it, vi } from "vitest";

import { env } from "cloudflare:workers";

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => new Headers(),
}));

// CAPTCHA_STUB must be bound before platform.ts composes the app — the
// captcha driver is selected once, at layer build time.
env.CAPTCHA_STUB = "1";

const { Route } = await import("./auth.$.ts");

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

const post = (body: unknown, headers: Record<string, string> = {}) =>
	new Request("http://localhost:3000/api/auth/sign-in/email", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

describe("auth route captcha stub", () => {
	it("stub verifier accepts missing token and reaches better-auth", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({ request: post({ email: "a@b.com" }) } as never);
		expect(res.status).not.toBe(403);
	});

	it("stub verifier rejects wrong token with 403", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({
			request: post({ email: "a@b.com", captchaToken: "wrong" }),
		} as never);
		expect(res.status).toBe(403);
	});

	it("stub verifier accepts STUB_CAPTCHA_TOKEN and reads remote ip", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({
			request: post(
				{ email: "a@b.com", captchaToken: "ktb-captcha-stub" },
				{ "cf-connecting-ip": "1.2.3.4" },
			),
		} as never);
		expect(res.status).not.toBe(403);
	});

	it("malformed JSON body yields null captchaToken", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({ request: post("{not json") } as never);
		// stub accepts undefined token → not 403
		expect(res.status).not.toBe(403);
	});
});

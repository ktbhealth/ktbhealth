import { beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "cloudflare:workers";

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => new Headers(),
}));

// TURNSTILE_SECRET_KEY must be bound before platform.ts composes the app —
// the captcha driver is selected once, at layer build time.
env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";

const { Route } = await import("./auth.$.ts");

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

const post = (body: unknown) =>
	new Request("http://localhost:3000/api/auth/sign-in/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

describe("auth route captcha", () => {
	beforeAll(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (String(url).includes("siteverify")) {
					return { ok: true, json: async () => ({ success: true }) };
				}
				return { ok: true, json: async () => ({}) };
			}),
		);
	});

	it("rejects credential posts without a valid captcha token", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({ request: post({ email: "a@b.com" }) } as never);
		expect(res.status).toBe(403);
		expect(((await res.json()) as { code: string }).code).toBe("CAPTCHA_FAILED");
	});

	it("passes credential posts with a valid captcha token", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({
			request: post({ email: "a@b.com", password: "x", captchaToken: "tok" }),
		} as never);
		// reaches better-auth (400/401 for bad credentials, not 403 captcha)
		expect(res.status).not.toBe(403);
	});

	it("rejects verification-email resends without a valid captcha token", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({
			request: new Request("http://localhost:3000/api/auth/send-verification-email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "a@b.com" }),
			}),
		} as never);
		expect(res.status).toBe(403);
		expect(((await res.json()) as { code: string }).code).toBe("CAPTCHA_FAILED");
	});

	it("skips captcha for non-credential paths", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({
			request: new Request("http://localhost:3000/api/auth/sign-out", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		} as never);
		expect(res.status).not.toBe(403);
	});
});

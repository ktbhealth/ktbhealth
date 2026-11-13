import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptchaVerifier } from "@ktb/captcha";
import { setServerRuntime, type ServerRuntime } from "@ktb/server-fns";

import { Route } from "./api-routes/auth.$.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

// In-plugin harness (P-033): the route reaches the app runtime through
// @ktb/server-fns, so the test publishes its own runtime stub — a
// mutable Captcha box behind `run` (the only effect the route runs is
// Effect.service(Captcha)) and a mutable authHandler behind the
// ServerRuntime capability the composition root wires to better-auth.
const captchaBox: { current: CaptchaVerifier | null } = { current: null };
const gate = { enabled: true };
const authCalls: string[] = [];

const runtime = {
	run: (() => Promise.resolve(captchaBox.current)) as unknown as ServerRuntime["run"],
	runAs: (() =>
		Promise.reject(new Error("runAs unused in auth routes"))) as unknown as ServerRuntime["runAs"],
	audioTranscribeModel: "test-model",
	getLocale: () => "en",
	pluginEnabled: async () => gate.enabled,
	authHandler: undefined as ((request: Request) => Promise<Response>) | undefined,
};

setServerRuntime(runtime);

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
	new Request(`http://x/api/auth${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

beforeEach(() => {
	captchaBox.current = null;
	gate.enabled = true;
	authCalls.length = 0;
	runtime.authHandler = async (request) => {
		authCalls.push(new URL(request.url).pathname);
		return Response.json({ ok: true });
	};
});

describe("plugin enable gate (createPluginApiRoute)", () => {
	it("answers 404 on GET and POST when auth.routes is disabled", async () => {
		gate.enabled = false;
		const h = handlersOf(Route);
		const get = await h.GET!({
			request: new Request("http://x/api/auth/get-session"),
		} as never);
		expect(get.status).toBe(404);
		expect(await get.json()).toEqual({ error: "not found" });
		const postRes = await h.POST!({
			request: post("/sign-out", {}),
		} as never);
		expect(postRes.status).toBe(404);
		expect(authCalls).toHaveLength(0);
	});
});

describe("GET /api/auth/*", () => {
	it("delegates to the authHandler capability", async () => {
		const h = handlersOf(Route);
		const res = await h.GET!({
			request: new Request("http://x/api/auth/get-session"),
		} as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(authCalls).toEqual(["/api/auth/get-session"]);
	});

	it("answers 500 when no authHandler capability is published", async () => {
		runtime.authHandler = undefined;
		const h = handlersOf(Route);
		const res = await h.GET!({
			request: new Request("http://x/api/auth/get-session"),
		} as never);
		expect(res.status).toBe(500);
	});
});

describe("POST /api/auth/* captcha gate", () => {
	it("skips the check for non-credential paths", async () => {
		const verify = vi.fn(async () => false);
		captchaBox.current = { verify };
		const h = handlersOf(Route);
		const res = await h.POST!({ request: post("/sign-out", {}) } as never);
		expect(res.status).toBe(200);
		expect(verify).not.toHaveBeenCalled();
		expect(authCalls).toEqual(["/api/auth/sign-out"]);
	});

	it("skips the check when Captcha resolves null (bot checks disabled)", async () => {
		const h = handlersOf(Route);
		const res = await h.POST!({ request: post("/sign-in/email", { email: "a@b.com" }) } as never);
		expect(res.status).toBe(200);
		expect(authCalls).toEqual(["/api/auth/sign-in/email"]);
	});

	it("rejects credential posts when verification fails", async () => {
		const verify = vi.fn(async () => false);
		captchaBox.current = { verify };
		const h = handlersOf(Route);
		const res = await h.POST!({
			request: post("/sign-in/email", { email: "a@b.com" }),
		} as never);
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ code: "CAPTCHA_FAILED" });
		expect(verify).toHaveBeenCalledWith(undefined, undefined);
		expect(authCalls).toHaveLength(0);
	});

	it("passes credential posts when verification succeeds, forwarding the token and remote ip", async () => {
		const verify = vi.fn(async () => true);
		captchaBox.current = { verify };
		const h = handlersOf(Route);
		const res = await h.POST!({
			request: post(
				"/sign-up/email",
				{ email: "a@b.com", captchaToken: "tok" },
				{ "cf-connecting-ip": "1.2.3.4" },
			),
		} as never);
		expect(res.status).toBe(200);
		expect(verify).toHaveBeenCalledWith("tok", "1.2.3.4");
		expect(authCalls).toEqual(["/api/auth/sign-up/email"]);
	});

	it("treats a malformed JSON body as a missing captcha token", async () => {
		const verify = vi.fn(async () => true);
		captchaBox.current = { verify };
		const h = handlersOf(Route);
		const res = await h.POST!({ request: post("/sign-in/email", "{not json") } as never);
		expect(res.status).toBe(200);
		expect(verify).toHaveBeenCalledWith(undefined, undefined);
	});
});

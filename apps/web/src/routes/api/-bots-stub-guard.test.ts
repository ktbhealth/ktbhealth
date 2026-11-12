import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const headers = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));

import { auth } from "#/lib/platform.ts";
import { signUpDoctor } from "#/test/doctor.ts";
import { Route as BotsRoute } from "./bots.ts";

// No RECALL_API_KEY → the Bot driver selects the stub provider. Outside dev
// (import.meta.env.DEV false) the route must refuse to simulate a call.

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

describe("bots route with the stub provider outside dev", () => {
	beforeAll(async () => {
		await signUpDoctor({ email: "stubguard@x.com", password: "senha-forte-123", name: "Dra Stub" });
		const res = await auth.handler(
			new Request("http://localhost:3000/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "stubguard@x.com", password: "senha-forte-123" }),
			}),
		);
		headers.current = new Headers({ cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] });
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("refuses with 503 and warns instead of joining a fake bot", async () => {
		vi.stubEnv("DEV", false);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const res = await handlersOf(BotsRoute).POST!({
			request: new Request("http://x/api/bots", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ meetUrl: "https://meet.google.com/abc-defg-hij" }),
			}),
		} as never);
		expect(res.status).toBe(503);
		await expect(res.json()).resolves.toEqual({ error: "meeting bot is not configured" });
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("stub provider selected outside dev"),
		);
	});
});

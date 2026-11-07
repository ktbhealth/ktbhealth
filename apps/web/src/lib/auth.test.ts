import { beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));

import { auth } from "./platform.ts";
import { ensureSessionUser, getSessionUser } from "./auth.ts";

let sessionCookie = "";

async function signInAndGetCookie() {
	await auth.api.signUpEmail({
		body: { email: "dra@x.com", password: "senha-forte-123", name: "Dra Ana" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "dra@x.com", password: "senha-forte-123" }),
		}),
	);
	const setCookie = res.headers.get("set-cookie") ?? "";
	return setCookie.split(";")[0];
}

describe("auth helpers", () => {
	beforeAll(async () => {
		sessionCookie = await signInAndGetCookie();
		headers.current = new Headers({ cookie: sessionCookie });
	});

	it("getSessionUser returns the signed-in user", async () => {
		const u = await getSessionUser();
		expect(u?.email).toBe("dra@x.com");
		expect(u?.name).toBe("Dra Ana");
		expect(u?.id).toBeTruthy();
	});

	it("getSessionUser returns null without session", async () => {
		headers.current = new Headers();
		expect(await getSessionUser()).toBeNull();
		expect(await getSessionUser(new Headers())).toBeNull();
	});

	it("ensureSessionUser returns user or throws", async () => {
		headers.current = new Headers();
		await expect(ensureSessionUser()).rejects.toThrow("unauthenticated");
		headers.current = new Headers({ cookie: sessionCookie });
		const u = await ensureSessionUser();
		expect(u.email).toBe("dra@x.com");
	});

	it("maps a missing user name to null", async () => {
		const spy = vi.spyOn(auth.api, "getSession").mockResolvedValue({
			user: { id: "u1", email: "e@x.com", name: undefined },
			session: {},
		} as never);
		headers.current = new Headers({ cookie: sessionCookie });
		const u = await getSessionUser();
		expect(u?.name).toBeNull();
		spy.mockRestore();
	});
});

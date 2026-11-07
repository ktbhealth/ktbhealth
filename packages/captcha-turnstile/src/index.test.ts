import { afterEach, describe, expect, it, vi } from "vitest";

import { makeTurnstileVerifier } from "./index.ts";

afterEach(() => vi.unstubAllGlobals());

describe("turnstile verifier", () => {
	it("fails closed without a token", async () => {
		const v = makeTurnstileVerifier("secret");
		expect(await v.verify(undefined)).toBe(false);
		expect(await v.verify("")).toBe(false);
	});

	it("returns true on success", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })),
		);
		const v = makeTurnstileVerifier("secret");
		expect(await v.verify("tok", "1.2.3.4")).toBe(true);
		const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(String(init.body)).toContain("remoteip=1.2.3.4");
	});

	it("omits remoteip when absent", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })),
		);
		await makeTurnstileVerifier("s").verify("tok");
		const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(String(init.body)).not.toContain("remoteip");
	});

	it("returns false on http error, non-success and network failure", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
		expect(await makeTurnstileVerifier("s").verify("t")).toBe(false);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) })),
		);
		expect(await makeTurnstileVerifier("s").verify("t")).toBe(false);

		vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("net"))));
		expect(await makeTurnstileVerifier("s").verify("t")).toBe(false);
	});
});

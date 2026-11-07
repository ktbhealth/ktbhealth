import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Captcha, nullCaptchaDriver, type CaptchaVerifier } from "./index.ts";

describe("captcha port", () => {
	it("is satisfied by a fail-closed implementation", async () => {
		const v: CaptchaVerifier = { verify: async () => false };
		expect(await v.verify("x")).toBe(false);
	});
});

describe("nullCaptchaDriver", () => {
	it("is eligible only when no captcha env is set", () => {
		expect(nullCaptchaDriver.id).toBe("captcha-none");
		expect(nullCaptchaDriver.port).toBe(Captcha.key);
		expect(nullCaptchaDriver.when?.({})).toBe(true);
		expect(nullCaptchaDriver.when?.({ CAPTCHA_STUB: "1" })).toBe(false);
		expect(nullCaptchaDriver.when?.({ TURNSTILE_SECRET_KEY: "k" })).toBe(false);
		expect(nullCaptchaDriver.when?.({ CAPTCHA_STUB: "1", TURNSTILE_SECRET_KEY: "k" })).toBe(false);
	});

	it("provides a null Captcha service", async () => {
		const captcha = await Effect.runPromise(
			Effect.service(Captcha).pipe(
				Effect.provide(nullCaptchaDriver.provides({}) as Layer.Layer<Captcha, never, never>),
			),
		);
		expect(captcha).toBeNull();
	});
});

import { describe, expect, it } from "vitest";

import { Captcha } from "@ktb/captcha";
import {
	makeStubVerifier,
	STUB_CAPTCHA_TOKEN,
	StubCaptchaLive,
	stubCaptchaDriver,
} from "./index.ts";

describe("stub captcha verifier", () => {
	it("accepts absent and stub tokens, rejects others", async () => {
		const v = makeStubVerifier();
		expect(await v.verify(undefined)).toBe(true);
		expect(await v.verify("")).toBe(true);
		expect(await v.verify(STUB_CAPTCHA_TOKEN)).toBe(true);
		expect(await v.verify("real-looking-token")).toBe(false);
	});
});

describe("stubCaptchaDriver", () => {
	it("is eligible only when CAPTCHA_STUB is set", () => {
		expect(stubCaptchaDriver.id).toBe("captcha-stub");
		expect(stubCaptchaDriver.port).toBe(Captcha.key);
		expect(stubCaptchaDriver.when?.({})).toBe(false);
		expect(stubCaptchaDriver.when?.({ CAPTCHA_STUB: "1" })).toBe(true);
	});

	it("provides the stub layer", () => {
		expect(stubCaptchaDriver.provides({ CAPTCHA_STUB: "1" })).toBe(StubCaptchaLive);
	});
});

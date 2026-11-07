import type { CaptchaDriverEnv, CaptchaVerifier } from "@ktb/captcha";
import type { Driver } from "@ktb/driver-framework";

/**
 * Token the stub accepts when a client does send one (e.g. tests that
 * exercise the captchaToken path explicitly).
 */
export const STUB_CAPTCHA_TOKEN = "ktb-captcha-stub";

/**
 * Local-dev / e2e impl of the CaptchaVerifier port. Accepts a missing
 * token (no widget is rendered without a site key) or STUB_CAPTCHA_TOKEN;
 * rejects anything else. NEVER bind this in production: it defeats the
 * bot check by design.
 */
import * as Layer from "effect/Layer";
import { Captcha } from "@ktb/captcha";

export const makeStubVerifier = (): CaptchaVerifier => ({
	verify: async (token) => token === undefined || token === "" || token === STUB_CAPTCHA_TOKEN,
});

/** Live layer for local/dev deployments. */
export const StubCaptchaLive = Layer.succeed(Captcha, makeStubVerifier());

/**
 * Local-dev driver: eligible only when CAPTCHA_STUB is set. Ordered
 * before the Turnstile driver so the stub wins when both are present.
 */
export const stubCaptchaDriver: Driver<CaptchaDriverEnv> = {
	id: "captcha-stub",
	port: Captcha.key,
	provides: () => StubCaptchaLive,
	when: (env) => Boolean(env.CAPTCHA_STUB),
};

import type { CaptchaVerifier } from "@ktb/captcha";

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
export const makeStubVerifier = (): CaptchaVerifier => ({
	verify: async (token) => token === undefined || token === "" || token === STUB_CAPTCHA_TOKEN,
});

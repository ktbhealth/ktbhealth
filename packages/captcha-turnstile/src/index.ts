import type { CaptchaDriverEnv, CaptchaVerifier } from "@ktb/captcha";
import type { Driver } from "@ktb/driver-framework";
import { Captcha } from "@ktb/captcha";
import * as Layer from "effect/Layer";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare Turnstile impl of the CaptchaVerifier port. */
export const makeTurnstileVerifier = (secretKey: string): CaptchaVerifier => ({
	async verify(token, remoteIp) {
		if (!token) return false;
		try {
			const body = new URLSearchParams({ secret: secretKey, response: token });
			if (remoteIp) body.set("remoteip", remoteIp);
			const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
			if (!res.ok) return false;
			const data = (await res.json()) as { success?: boolean };
			return data.success === true;
		} catch {
			return false;
		}
	},
});

/** Live layer for a Turnstile-backed deployment. */
export const TurnstileCaptchaLive = (secretKey: string) =>
	Layer.succeed(Captcha, makeTurnstileVerifier(secretKey));

/**
 * Turnstile driver: eligible when its secret is bound and CAPTCHA_STUB
 * is not set (the stub keeps precedence for local dev).
 */
export const turnstileCaptchaDriver: Driver<CaptchaDriverEnv> = {
	id: "captcha-turnstile",
	port: Captcha.key,
	provides: (env) => TurnstileCaptchaLive(env.TURNSTILE_SECRET_KEY ?? ""),
	when: (env) => !env.CAPTCHA_STUB && Boolean(env.TURNSTILE_SECRET_KEY),
};

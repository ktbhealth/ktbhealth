import type { CaptchaVerifier } from "@ktb/captcha";

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

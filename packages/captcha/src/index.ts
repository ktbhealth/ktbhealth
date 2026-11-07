import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type { Driver } from "@ktb/driver-framework";

/**
 * Bot-check port: verifies a client-solved challenge token server-side.
 * Provider-agnostic; impls live in sibling packages (e.g. @ktb/captcha-turnstile).
 */
export interface CaptchaVerifier {
	/**
	 * True when the token proves the challenge was solved by a human.
	 * Implementations must fail closed: missing/invalid tokens, network
	 * errors and malformed responses all resolve to false.
	 */
	verify(token: string | undefined, remoteIp?: string): Promise<boolean>;
}

/**
 * Captcha service — the configured verifier, or null when bot checks
 * are disabled for this deployment.
 */
export class Captcha extends Context.Service<Captcha, CaptchaVerifier | null>()(
	"@ktb/captcha/Captcha",
) {}

/** Env slice read by Captcha port drivers (mirrors app-host AppEnv). */
export interface CaptchaDriverEnv {
	readonly CAPTCHA_STUB?: unknown;
	readonly TURNSTILE_SECRET_KEY?: string;
}

/**
 * Disabled bot-check driver: Captcha resolves to null and credential
 * endpoints skip verification. Last in the captcha driver list — eligible
 * only when neither CAPTCHA_STUB nor TURNSTILE_SECRET_KEY is set.
 */
export const nullCaptchaDriver: Driver<CaptchaDriverEnv> = {
	id: "captcha-none",
	port: Captcha.key,
	provides: () => Layer.succeed(Captcha, null),
	when: (env) => !env.CAPTCHA_STUB && !env.TURNSTILE_SECRET_KEY,
};

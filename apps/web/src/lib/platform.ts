import { env } from "cloudflare:workers";
import * as Layer from "effect/Layer";
import { Binding, makeDb } from "@ktb/db";
import { makeAuth } from "@ktb/auth-better";
import { makeStubVerifier } from "@ktb/captcha-stub";
import { makeTurnstileVerifier } from "@ktb/captcha-turnstile";
import type { CaptchaVerifier } from "@ktb/captcha";

// Platform glue: everything platform-specific lives here, libs stay
// agnostic. cloudflare:workers env is evaluated per-request by workerd.
export const BindingLive = Layer.succeed(Binding, env.DB);

export const db = makeDb(env.DB);
export const ai = env.AI;
export const auth = makeAuth(db, {
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
});

// Bot check on credential endpoints. CAPTCHA_STUB (wrangler dev var, never
// set in the Alchemy stack) selects the local stub; otherwise Turnstile when
// its secret is bound; null skips verification entirely.
export const captcha: CaptchaVerifier | null = env.CAPTCHA_STUB
	? makeStubVerifier()
	: env.TURNSTILE_SECRET_KEY
		? makeTurnstileVerifier(env.TURNSTILE_SECRET_KEY)
		: null;

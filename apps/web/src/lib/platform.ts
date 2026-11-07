import { env } from "cloudflare:workers";
import * as Layer from "effect/Layer";
import { Binding, makeDb } from "@ktb/db";
import { makeAuth } from "@ktb/auth-better";
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

// Bot check on credential endpoints. Null when no secret is bound (local
// dev without arca): the auth route skips verification in that case.
export const captcha: CaptchaVerifier | null = env.TURNSTILE_SECRET_KEY
	? makeTurnstileVerifier(env.TURNSTILE_SECRET_KEY)
	: null;

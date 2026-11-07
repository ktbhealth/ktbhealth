import { env } from "cloudflare:workers";
import { plugins } from "#/plugins.ts";
import { BotLive } from "@ktb/bot-recall";
import * as Layer from "effect/Layer";
import { Binding, makeDb } from "@ktb/db";
import { makeAuth } from "@ktb/auth-better";
import { StubCaptchaLive } from "@ktb/captcha-stub";
import { TurnstileCaptchaLive } from "@ktb/captcha-turnstile";
import { Captcha } from "@ktb/captcha";

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
export const CaptchaLive = env.CAPTCHA_STUB
	? StubCaptchaLive
	: env.TURNSTILE_SECRET_KEY
		? TurnstileCaptchaLive(env.TURNSTILE_SECRET_KEY)
		: Layer.succeed(Captcha, null);

/** Composed plugin + infra services. Plugin `services` layers merge here;
 * platform bindings (D1) are provided underneath. */
const pluginServices = plugins
	.map((p) => p.services)
	.filter((s): s is NonNullable<typeof s> => s !== undefined);
export const AppLive = Layer.mergeAll(BotLive, CaptchaLive, ...pluginServices).pipe(
	Layer.provideMerge(BindingLive),
);

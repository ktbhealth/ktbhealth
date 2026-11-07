import { env } from "cloudflare:workers";
import * as Layer from "effect/Layer";
import { Binding, makeDb } from "@ktb/db";
import { makeAuth } from "@ktb/auth-better";

// Platform glue: everything platform-specific lives here, libs stay
// agnostic. cloudflare:workers env is evaluated per-request by workerd.
export const BindingLive = Layer.succeed(Binding, env.DB);

export const db = makeDb(env.DB);
export const ai = env.AI;
export const auth = makeAuth(db, {
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
});

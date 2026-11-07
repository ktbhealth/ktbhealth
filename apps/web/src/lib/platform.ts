import { env } from "cloudflare:workers";
import * as Layer from "effect/Layer";
import { Binding, makeDb } from "@ktb/db";

// Platform glue: everything platform-specific lives here, libs stay
// agnostic. cloudflare:workers env is evaluated per-request by workerd.
export const BindingLive = Layer.succeed(Binding, env.DB);

export const db = makeDb(env.DB);
export const ai = env.AI;

import { env } from "cloudflare:workers";

import { createApp } from "@ktb/app-host";
import { Db } from "@ktb/db";
import * as Effect from "effect/Effect";

// Deploy-target glue: the only place cloudflare:workers env is read.
// All composition (plugin registry, layers, runtime) lives in @ktb/app-host.
export const app = createApp(env);

export const { plugins, BindingLive, CaptchaLive, AppLive, runtime, run, db, auth } = app;

/** @deprecated use run + domain services */
export const withDb = <A>(f: (db: import("@ktb/db").DbClient) => Promise<A>): Promise<A> =>
	run(Effect.service(Db).pipe(Effect.flatMap((db) => Effect.promise(() => f(db)))));

// Raw platform binding passthrough — not composed, just exposed.
export const ai = env.AI;

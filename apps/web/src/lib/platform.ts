import { env } from "cloudflare:workers";

import { createApp } from "@ktb/app-host";

// Deploy-target glue: the only place cloudflare:workers env is read.
// All composition (plugin registry, layers, runtime) lives in @ktb/app-host.
export const app = createApp(env);

export const { plugins, BindingLive, CaptchaLive, AppLive, runtime, withDb, db, auth } = app;

// Raw platform binding passthrough — not composed, just exposed.
export const ai = env.AI;

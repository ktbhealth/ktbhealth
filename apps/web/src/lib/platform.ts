import { env } from "cloudflare:workers";

import { createApp } from "@ktb/app-host";

// Deploy-target glue: the only place cloudflare:workers env is read.
// All composition (plugin registry, layers, runtime) lives in @ktb/app-host.
// LLM keys may come from wrangler vars/secrets (env) or the dev shell
// (process.env via nodejs_compat) — bindings win.
const LLM_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"LLM_API_KEY",
	"OPENAI_API_KEY",
	"LLM_BASE_URL",
	"LLM_MODEL",
	"REVIEW_MODEL",
	"REVIEW_PROVIDER",
	"OLLAMA_URL",
	"WORKERS_AI_MODEL",
] as const;

const appEnv = { ...env } as Record<string, unknown>;
for (const key of LLM_ENV_KEYS) {
	appEnv[key] ??= process.env[key];
}

export const app = createApp(appEnv as unknown as typeof env);

export const { plugins, BindingLive, CaptchaLive, AppLive, runtime, run, runAs, db, auth } = app;

// Raw platform binding passthrough — not composed, just exposed.
export const ai = env.AI;

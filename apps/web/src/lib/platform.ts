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
	"WORKERS_AI_MODEL",
] as const;

// Non-LLM config passthrough — same bindings-win-then-process.env rule.
const APP_ENV_KEYS = ["PLATFORM_ADMIN_EMAILS"] as const;

const appEnv = { ...env } as Record<string, unknown>;
for (const key of [...LLM_ENV_KEYS, ...APP_ENV_KEYS]) {
	appEnv[key] ??= process.env[key];
}

export const app = createApp(appEnv as unknown as typeof env);

export const {
	plugins,
	BindingLive,
	CaptchaLive,
	AppLive,
	runtime,
	run,
	runAs,
	correctTranscript,
	db,
	auth,
} = app;

// Raw platform binding passthrough — not composed, just exposed.
export const ai = env.AI;
export const audioBucket = env.AUDIO_BUCKET;
export const audioQueue = env.AUDIO_QUEUE;

import { env } from "cloudflare:workers";

import { resolveAi, type AiEnv } from "./ai.ts";
import { createApp } from "@ktb/app-host";
import type { ExportFormat, RecordExporter } from "@ktb/interop";
import { fhirR4Exporter } from "@ktb/interop-fhir";
import { openEhrExporter } from "@ktb/interop-openehr";

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

// AI_STUB > AI_LOCAL_URL > env.AI — dev may run without the Workers AI
// binding (wrangler.dev.jsonc), so resolve before composing the app.
const aiBinding = resolveAi(env as unknown as AiEnv, process.env);

const appEnv = { ...env, AI: aiBinding } as Record<string, unknown>;
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
export const ai = aiBinding;
export const audioBucket = env.AUDIO_BUCKET;
export const audioQueue = env.AUDIO_QUEUE;

/** Interop adapters behind the @ktb/interop port, one per supported standard. */
export const recordExporters: Record<ExportFormat, RecordExporter> = {
	"fhir-r4": fhirR4Exporter,
	openehr: openEhrExporter,
};

import { env } from "cloudflare:workers";

import { setServerRuntime } from "@ktb/server-fns";
import { getLocale } from "#/paraglide/runtime.js";

import { resolveAi, type AiEnv } from "./ai.ts";
import { createApp } from "@ktb/app-host";
import type { ExportFormat, RecordExporter } from "@ktb/interop";
import { fhirR4Exporter } from "@ktb/interop-fhir";
import { openEhrExporter } from "@ktb/interop-openehr";

// Deploy-target glue: the only place cloudflare:workers env is read.
// All composition (plugin registry, layers, runtime) lives in @ktb/app-host.
// Secrets/config reach the worker as bindings only — dev via .dev.vars
// (scripts/dev-secrets.mjs), prod via the Alchemy stack (alchemy.run.ts).
// No process.env reads: the worker stays portable across runtimes.

// AI_STUB > AI_BASE_URL > env.AI — dev may run without the Workers AI
// binding (wrangler.dev.jsonc), so resolve before composing the app.
const aiBinding = resolveAi(env as unknown as AiEnv);

const appEnv = { ...env, AI: aiBinding } as Record<string, unknown>;

const app = createApp(appEnv as unknown as typeof env);

export const {
	BindingLive,
	CaptchaLive,
	run,
	runAs,
	correctTranscript,
	db,
	auth,
	// Full server registry (tables/services/panel page loaders) — the
	// counterpart of the client-safe `plugins` in #/plugins.ts. Server
	// fns that dispatch `panel.pages` handlers read this; it must never
	// be imported by client-reachable module scope.
	plugins: serverPlugins,
} = app;

/** Fallback transcription model when AUDIO_TRANSCRIBE_MODEL is unset —
 * deploy glue owns provider defaults; ports carry no provider literals. */
const DEFAULT_AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** Model id for the server-side audio transcription job — bound per
 * deploy (Workers AI model on Cloudflare, ignored by OpenAI-compatible
 * stand-ins). Defaults to the recommended Workers AI Whisper model. */
export const audioTranscribeModel =
	appEnv.AUDIO_TRANSCRIBE_MODEL?.toString() ?? DEFAULT_AUDIO_MODEL;

/** Interop adapters behind the @ktb/interop port, one per supported standard. */
const recordExporters: Record<ExportFormat, RecordExporter> = {
	"fhir-r4": fhirR4Exporter,
	openehr: openEhrExporter,
};

// P-033: publish the runtime to @ktb/server-fns so plugin-owned server
// functions (plugins/*/src/**) reach run/runAs, audio purge and locale
// without importing this module. Env reads stay here — the registry
// only hands out already-resolved capabilities.
setServerRuntime({
	run,
	runAs,
	audio: env.AUDIO_BUCKET,
	audioQueue: env.AUDIO_QUEUE,
	ai: aiBinding,
	audioTranscribeModel,
	recordExporters,
	getLocale,
});

// Raw platform binding passthrough — not composed, just exposed.
export const ai = aiBinding;
export const audioBucket = env.AUDIO_BUCKET;

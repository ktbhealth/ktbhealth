import { env } from "cloudflare:workers";

import {
	audioStorageStats,
	getTenantSelector,
	setServerRuntime,
	type AudioObjectLister,
	type QueueDepth,
} from "@ktb/server-fns";
import type { TenantSelector } from "@ktb/tenant/selector";
import { makeTenantResolver } from "@ktb/tenant";
import { makeDb, type SqlDatabase } from "@ktb/db";
import type * as Effect from "effect/Effect";
import { getLocale } from "#/paraglide/runtime.js";

import { resolveAi, type AiEnv } from "./ai.ts";
import { makeTenantDirectory } from "./tenant-directory.ts";
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

// Tenant resolution (P-053, phase A): the directory reads the groups
// plugin's membership tables directly (edge adapter — the groups
// service is PlatformAdmin-gated); resolution runs per request inside
// runAs. Fallback stays "personal" so requests without a tenant
// selector keep the pre-tenancy ownerId-scoped behavior. With no
// selector, a user with exactly one membership auto-selects it; zero
// or several memberships fall through to personal scope.
const tenantResolver = makeTenantResolver({
	directory: makeTenantDirectory(makeDb(env.DB as unknown as SqlDatabase)),
	fallback: "personal",
	selectDefault: (memberships) => (memberships.length === 1 ? memberships[0] : undefined),
});

const app = createApp(appEnv as unknown as typeof env, { tenantResolver });

export const {
	BindingLive,
	CaptchaLive,
	run,
	correctTranscript,
	db,
	auth,
	// Full server registry (tables/services/panel page loaders) — the
	// counterpart of the client-safe `plugins` in #/plugins.ts. Server
	// fns that dispatch `panel.pages` handlers read this; it must never
	// be imported by client-reachable module scope.
	plugins: serverPlugins,
} = app;

/**
 * `runAs` with tenant-selector extraction (P-053): when the caller does
 * not pass a selector, the request's tenant headers
 * (`x-tenant-id`/`x-tenant-slug`/`x-tenant-kind`/`x-tenant`) are read and
 * forwarded to the app's TenantResolver, which binds `Tenant` inside
 * the per-request effect scope. An explicit `null` selector skips
 * extraction; extraction failures outside a request context (tests,
 * non-HTTP invocations) degrade to `null` — ambient tenant is never
 * inherited into background work.
 */
export const runAs = <A, E>(
	user: { readonly id: string; readonly email?: string },
	effect: Effect.Effect<A, E, unknown>,
	tenantSelector?: TenantSelector | null,
): Promise<A> => {
	if (tenantSelector !== undefined) {
		return app.runAs(user, effect, tenantSelector);
	}
	return (async () => {
		let selector: TenantSelector | null = null;
		try {
			selector = await getTenantSelector();
		} catch {
			// No request context — personal scope.
		}
		return app.runAs(user, effect, selector);
	})();
};

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

// Ops probes (T-035): the queue depth signal exists only when the bound
// queue exposes stats — the dev:node SQLite queue does; the workerd
// Queue binding doesn't (prod queues are managed in the Cloudflare
// dashboard, so the ops console reports them as externally managed).
// The storage probe paginates the bucket's list() with a page cap; a
// missing listing capability or a failed page resolves null → the page
// shows "unavailable", never a fake zero.
const queueDepthProbe = (env.AUDIO_QUEUE as { stats?: () => Promise<QueueDepth> } | undefined)
	?.stats;
const audioBucketLister = env.AUDIO_BUCKET as unknown as AudioObjectLister | undefined;

// P-033: publish the runtime to @ktb/server-fns so plugin-owned server
// functions (plugins/*/src/**) reach run/runAs, audio purge and locale
// without importing this module. Env reads stay here — the registry
// only hands out already-resolved capabilities.
setServerRuntime({
	run,
	runAs,
	audio: env.AUDIO_BUCKET,
	audioQueue: env.AUDIO_QUEUE,
	audioQueueDepth:
		typeof queueDepthProbe === "function" ? () => queueDepthProbe().catch(() => null) : undefined,
	audioStorageStats:
		audioBucketLister === undefined ? undefined : () => audioStorageStats(audioBucketLister),
	ai: aiBinding,
	audioTranscribeModel,
	recordExporters,
	getLocale,
});

// Raw platform binding passthrough — not composed, just exposed.
export const ai = aiBinding;
export const audioBucket = env.AUDIO_BUCKET;

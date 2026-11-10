import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { makeSqliteDatabase } from "@ktb/db-sqlite";

import { resolveAi, type AiEnv } from "./ai.ts";
import { makeLocalAudioBucket, makeLocalAudioQueue } from "./node-audio.ts";

/**
 * Node/Bun stand-in for the `cloudflare:workers` module — aliased in
 * vite.config.ts only when `KTB_DEV_NODE=1` (script: `dev:node`).
 * Everywhere else the real workerd module is used and this file is
 * never bundled.
 *
 * Exports the same `env` surface platform.ts consumes, backed by
 * process.env instead of worker bindings. `DB` is a real SQLite file
 * via @ktb/db-sqlite (better-sqlite3) — the explicit non-Cloudflare
 * dev path — with the drizzle migrations applied at boot.
 *
 * Bindings without a workerd runtime get local equivalents (see
 * node-audio.ts): AUDIO_BUCKET is a filesystem object store under
 * ./data/audio (gitignored; override with AUDIO_BUCKET_DIR), and
 * AUDIO_QUEUE dispatches in-process to the same consumer handler
 * server.ts exports as `queue`. AI still resolves through
 * AI_STUB/AI_BASE_URL in lib/ai.ts — Workers AI itself has no Node
 * equivalent, so env.AI stays unset unless a stand-in resolves
 * (mirroring wrangler.dev.jsonc, which drops the binding).
 */

// Repo root from apps/web/src/lib → packages/db/drizzle holds the
// drizzle-kit migrations (+ meta/_journal.json ordering).
const MIGRATIONS_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../../packages/db/drizzle",
);

// Plain config/secrets process.env → worker-binding shape. Only keys
// the app actually reads are forwarded.
const ENV_KEYS = [
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
	"TURNSTILE_SECRET_KEY",
	"CAPTCHA_STUB",
	"ANTHROPIC_API_KEY",
	"LLM_API_KEY",
	"OPENAI_API_KEY",
	"LLM_BASE_URL",
	"LLM_MODEL",
	"WORKERS_AI_MODEL",
	"RECALL_API_KEY",
	"PLATFORM_ADMIN_EMAILS",
	"AUDIO_TRANSCRIBE_MODEL",
	"AI_STUB",
	"AI_BASE_URL",
] as const;

const env: Record<string, unknown> = {};
for (const key of ENV_KEYS) {
	const value = process.env[key];
	if (value !== undefined) env[key] = value;
}

// DATABASE_URL selects the SQLite file (default ./data/app.db relative
// to apps/web — the historical dev location). `sqlite:`/`file:` URLs
// and `:memory:` are accepted; see @ktb/db-sqlite sqliteFilename.
env.DB = makeSqliteDatabase({
	filename: process.env.DATABASE_URL ?? "./data/app.db",
	migrate: MIGRATIONS_DIR,
});

// R2 stand-in: object bytes as files under apps/web/data/audio
// (gitignored via the root `data/` rule). AUDIO_BUCKET_DIR overrides —
// same convention as DATABASE_URL picking the SQLite file.
const AUDIO_DIR =
	process.env.AUDIO_BUCKET_DIR ??
	resolve(dirname(fileURLToPath(import.meta.url)), "../../data/audio");
env.AUDIO_BUCKET = makeLocalAudioBucket(AUDIO_DIR);

// Queue stand-in: send() resolves immediately and delivers to the same
// consumer handler server.ts wires as the workerd `queue` export.
// audio-jobs.ts imports platform.ts (which imports this module), so the
// import is deferred to send-time — a static import would be a cycle.
env.AUDIO_QUEUE = makeLocalAudioQueue(async () => {
	const { handleAudioQueueBatch } = await import("./audio-jobs.ts");
	return handleAudioQueueBatch;
});

// AI: platform.ts runs resolveAi(env) itself (AI_STUB > AI_BASE_URL >
// env.AI). Resolve the stand-in here too so env.AI carries it for any
// raw-env reader; when nothing is configured env.AI stays undefined —
// same as wrangler.dev.jsonc dropping the binding — and consumers keep
// their honest "not configured" paths instead of a throwing stub.
const aiStandIn = resolveAi(env as AiEnv);
if (aiStandIn !== undefined) env.AI = aiStandIn;

export { env };

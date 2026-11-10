import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { makeSqliteDatabase } from "@ktb/db-sqlite";

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
 * Bindings with no Node equivalent (AUDIO_BUCKET, AUDIO_QUEUE, AI)
 * stay undefined; AI still resolves through AI_STUB/AI_BASE_URL in
 * lib/ai.ts, and audio features fail only if exercised.
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

export { env };

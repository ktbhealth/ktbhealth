# KTB

> KTB turns medical conversations into lasting clinical knowledge.

KTB is a documentation platform for doctors that captures, transcribes,
organizes, and manages medical consultation conversations, reducing
the administrative burden of clinical documentation while preserving
the information generated during patient care.

## Problem

Brazilian doctors spend ~40% of a consultation documenting instead of
listening. Poorly recorded anamnesis means clinical errors, legal
exposure, and a 15-minute consult turning into 25 minutes of typing.
Existing EMRs make it worse: the physician types looking at the
screen, not the patient.

## Solution

Ambient scribe for medicine documentation: KTB captures the
consultation audio, stores it, transcribes it, and processes it into
a structured clinical anamnesis. The physician accesses it as a tool —
reviewing evidence, editing, approving — with total decision over
what enters the record.

We start with telemedicine because remote audio capture is simpler,
but in-person consultations are a core part of the vision. The AI
drafts; the physician decides. It supports clinical documentation; it
does not diagnose, prescribe, or suggest clinical decisions.

## The name

KTB comes from the Arabic root ك ت ب (K-T-B), associated with writing,
books, and documentation: writing down what matters, preserving
knowledge, and turning conversations into structured records that stay
accessible over time.

## Vision

A documentation platform connecting consultations, records, and patient
history into a continuous clinical workflow — the consultation context
compounds over time instead of disappearing into the next form. KTB is
a tool and a platform, never a decision-maker: the physician holds
total decision.

## Layout

- `apps/web` — TanStack Start app (Cloudflare Workers target)
- `plugins/` — domain plugins (`consultations`, `patients`), each with
  its own schema, routes, and views
- `packages/` — provider-neutral Effect ports and drivers
  (`transcription`, `anamnesis`, `auth`, `bot`, `captcha`, `export-pdf`,
  `kernel`, `driver-framework`, `db`, `app-host` composition root)
- `infra/` — deployment ports (`ports`) and the Cloudflare/Alchemy
  implementation (`cloudflare`)

Toolchain is Vite+ (`vp`) on Bun: check, fmt, lint, test, build in one
CLI.

## Running locally

```bash
bun install

# Default: dev boots workerd via wrangler.dev.jsonc with a local D1
# (SQLite under the hood) — same SqlDatabase port as prod.

bun run dev      # http://localhost:3000 (stub auth/captcha — no secrets needed)
bun run dev:node # same app on plain Node/Bun — DB is a real SQLite file
                 # (DATABASE_URL, default ./data/app.db) via @ktb/db-sqlite,
                 # drizzle migrations applied at boot. No workerd/D1.
                 # Loads apps/web/.dev.vars when present (real env vars win),
                 # so secrets written by dev:secrets carry over. For real
                 # secrets under dev:node: `KTB_DEV_NODE=1 bun run dev:secrets`.
bun run dev:secrets   # same, but injects real secrets via cuora (needs vault access)
bun run check    # fmt + lint + typecheck
bun run test     # vitest, per-package projects
bun run build    # production build (worker bundle)
bun run deploy   # alchemy deploy to Cloudflare (needs cuora vault access)
```

`DATABASE_URL` accepts a path, `:memory:`, or `sqlite:`/`file:` URLs
(see `@ktb/db-sqlite`). Under `dev:node` the Cloudflare bindings get
local equivalents (`apps/web/src/lib/node-audio.ts`): `AUDIO_BUCKET`
is a filesystem object store under `apps/web/data/audio`
(gitignored; override with `AUDIO_BUCKET_DIR`), and `AUDIO_QUEUE`
is a SQLite-backed queue (`apps/web/data/queue.db`; override with
`KTB_DEV_QUEUE_DB`) that dispatches to the same transcription
consumer workerd would invoke — jobs survive restarts, and messages
that exhaust retries stay as `failed` rows in the queue db (the
dead-letter queue; inspect/replay via `sqlite3 data/queue.db
"SELECT * FROM jobs WHERE status='failed'"`). AI resolves via
`AI_STUB`/`AI_BASE_URL` exactly as under `wrangler dev` — Workers AI
itself has no Node equivalent, so `env.AI` stays unset unless a
stand-in is configured.

## Related repos

- [`ui`](https://github.com/ktbhealth/ui) — design system (Tailwind v4
  tokens + React/Vue component libraries, git-tag installs)
- [`website-draft`](https://github.com/ktbhealth/website-draft) —
  landing site (TanStack Start SSR on Cloudflare Workers)
- [`storybook`](https://github.com/ktbhealth/storybook) — component
  catalog for the design system
- [`project`](https://github.com/ktbhealth/project) — task board, ADRs,
  and proposals (myco)
- [`docs`](https://github.com/ktbhealth/docs) — documentation site
  (Fumadocs, audience tabs: doctors/patients/developers/business)

## Status

v0 is deployed to Cloudflare Workers (Workers AI as the LLM fallback).
Roadmap, ADRs, and backlog live on the
[`project`](https://github.com/ktbhealth/project) board.

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

Ambient scribe for telemedicine: the app captures the consultation
audio → transcribes → structures a clinical anamnesis → the doctor
reviews and approves → export to the medical record.

The AI drafts; the physician decides. It supports clinical
documentation; it does not diagnose, prescribe, or suggest clinical
decisions.

## The name

KTB comes from the Arabic root ك ت ب (K-T-B), associated with writing,
books, and documentation: writing down what matters, preserving
knowledge, and turning conversations into structured records that stay
accessible over time.

## Vision

A documentation platform connecting consultations, records, and patient
history into a continuous clinical workflow — the consultation context
compounds over time instead of disappearing into the next form.

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

# apps/web/.env.local
#   DATABASE_URL=./data/app.db   (SQLite for local dev)

bun run dev      # http://localhost:3000 (stub auth/captcha — no secrets needed)
bun run dev:secrets   # same, but injects real secrets via cuora (needs vault access)
bun run check    # fmt + lint + typecheck
bun run test     # vitest, per-package projects
bun run build    # production build (worker bundle)
bun run deploy   # alchemy deploy to Cloudflare (needs cuora vault access)
```

## Related repos

- [`ui`](https://github.com/ktbhealth/ui) — design system (Tailwind v4
  tokens + React/Vue component libraries, git-tag installs)
- [`website-draft`](https://github.com/ktbhealth/website-draft) —
  landing site (TanStack Start SSR on Cloudflare Workers)
- [`storybook`](https://github.com/ktbhealth/storybook) — component
  catalog for the design system
- [`project`](https://github.com/ktbhealth/project) — task board, ADRs,
  and proposals (myco)

## Status

v0 is deployed to Cloudflare Workers (Workers AI as the LLM fallback).
Roadmap, ADRs, and backlog live on the
[`project`](https://github.com/ktbhealth/project) board.

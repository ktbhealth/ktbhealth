# KTB

> KTB turns medical conversations into lasting clinical knowledge.

KTB is a documentation platform for doctors: it captures the
consultation audio, transcribes it, and drafts a structured clinical
anamnesis. The physician reviews, edits, and approves — KTB never
diagnoses or recommends treatment.

## Problem

Doctors spend ~40% of a consult documenting instead of listening.
Existing EMRs make it worse: the physician types looking at the
screen, not the patient.

## Run

```bash
bun install
bun run dev         # http://localhost:3000 — stub auth/captcha, no secrets needed
bun run dev:node    # same app on plain Node + SQLite file (no workerd)
bun run dev:secrets # real secrets via cuora vault (needs access)
bun run check       # fmt + lint + typecheck
bun run test        # vitest, per-package
bun run build       # production build
bun run deploy      # Cloudflare via alchemy (needs vault access)
```

`DATABASE_URL` picks the SQLite file under `dev:node`
(default `./data/app.db`).

## Layout

- `apps/web` — the app (TanStack Start on Cloudflare Workers)
- `plugins/` — features as plugins: consultations, patients,
  pages, manager, etc. Each contributes routes, nav, pages, and UI;
  plugins can be toggled at runtime under `/platform/plugins`
- `packages/` — shared infrastructure (db, auth, transcription,
  anamnesis, plugin kernel)
- `infra/` — Cloudflare deployment (alchemy)

## Notes

- Plugin architecture: everything user-facing is a plugin
  contribution; `plugins/` depends on `packages/`, never the reverse.
  Details in `AGENTS.md`.
- v0 is deployed to Cloudflare Workers. Roadmap and ADRs live on the
  [`project`](https://github.com/ktbhealth/project) board.
- Related: [`ui`](https://github.com/ktbhealth/ui) design system,
  [`docs`](https://github.com/ktbhealth/docs) documentation site.

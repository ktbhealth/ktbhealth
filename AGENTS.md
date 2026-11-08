# KTB Health monorepo — agent guide

## Org repos — use them, don't reinvent

Sibling clones live next to this repo (`../<name>`); canonical sources
on GitHub under `github.com/ktbhealth/`:

- **`ui`** (`@ktbhealth/ui`) — THE design system: Tailwind v4 tokens +
  React (`@react`) and Vue component libraries. Source of truth for all
  UI. Consumed via git-tag deps (`github:ktbhealth/ui#vX.Y.Z@react`).
  - Never copy/vendor components into apps — missing component? Add it
    in `ui`, tag a release, bump the dep here.
  - Never edit `node_modules/@ktbhealth/ui` — changes are lost.
- **`storybook`** — component catalog for `ui`. Before building any UI,
  check existing stories/usage (`bun run dev` → :3100). New components
  get stories there.
- **`project`** — myco ledger: proposals, ADRs, tasks. `myco status
  --prompt` at session start; capture new work as proposals/tasks.
- **`presentation-draft`**, **`website-draft`**, **`slidev-theme-ktb`** —
  pitch/site/theme repos; not part of this build.

## Commands

- `bun run check` — fmt + lint + typecheck (run before committing)
- `bun run test` — vitest per-package
- `bun run build` — production build (root builds apps/web)
- `cd apps/web && bun run infra:deploy` — deploy to Cloudflare prod
  (needs cuora vault access)

## Conventions

- English everywhere (code, comments, commit messages).
- Domain logic as Effect services behind ports; adapters at the edge
  (see ADR-0001 in project repo — transcription sources, and the
  calendar/notification ports in P-008/P-009).
- Arch lint: plugins must not import from apps — inject via route
  composition (`api` objects in `apps/web/src/routes/`).
- Positioning: documentation-only — the physician decides, KTB
  records. No diagnosis/treatment/recommendation copy (T-021).
- Server fns validate wire input with effect/Schema — tolerate
  null/undefined/string coercions (see `normalizePatientId` in
  `apps/web/src/lib/fns.ts`).

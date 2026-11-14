# evals — domain packs + suite manifests

Everything eval lives here (P-075). The framework itself stays
domain-free: `packages/eval-core` knows stages/metrics/gates/caps as
registered contribution ids and nothing else; `plugins/` holds only
the shared capability registrars (`transcription.tts`/`asr`,
`llm.eval`, `storage.dataset`).

```
evals/
  <domain>/                  DOMAIN PACK — a plain workspace package
    package.json tsconfig    (@ktb/eval-<domain>, private, type: module)
    vitest.config.ts
    src/                     schema, ports, pipeline, metrics, gates,
                             personas, scriptgen, generate, negation,
                             locale(s), anonymize, acp, phi
    templates/<locale>/      .eta script templates
    <name>.suite.ts          suite manifest(s), colocated with the pack
```

- **Domain packs are NOT plugins.** No `definePlugin`, no `plugins`
  manifest, no `@ktb/kernel` augmentation, no `src/client.ts`. Each
  pack exports its contribution declarations as a plain array
  (`consultContributions` in `src/index.ts`); the composition root
  (`apps/eval/src/contributions.ts`) appends them to the registry
  after the capability plugins' manifest contributions.
- **Suite manifests are pure data** (`defineSuite` from
  `@ktb/eval-core`), one `*.suite.ts` per suite, colocated inside
  their domain pack. The `*.suite.ts` suffix is the manifest
  convention: any other `.ts` file is pack source or a shared helper
  and is never treated as a suite.
- **Adding an eval domain** = `evals/<domain>/` (copy the
  consultation shape) + `evals/<domain>/<name>.suite.ts`; zero
  framework or plugin changes. `apps/eval` wires the pack's
  contribution array into `ALL_CONTRIBUTIONS` explicitly.

## Discovery

`apps/eval` (`eval list`, `eval generate|run|gate|report <suite>`)
scans `evals/` **recursively** for `*.suite.ts` files
(`apps/eval/src/suites.ts`), skipping `node_modules` and
dot-directories, re-validating each through `validateManifest`.

## Runtime

The CLI (`apps/eval/src/cli.ts`) is runtime-agnostic: it uses only
`node:*` APIs (fs/path/child_process), `fetch`, and Effect — no
`Bun.*` globals or `bun:` imports anywhere in the eval packages.
Bun is the recommended runtime (the `#!/usr/bin/env bun` shebang and
`bun apps/eval/src/cli.ts …` invocations in the docs), but plain
Node works too — Node ≥ 23.6 strips TypeScript types natively:

```sh
node apps/eval/src/cli.ts list
node apps/eval/src/cli.ts generate consult-asr --workdir /tmp/eval-app
node apps/eval/src/cli.ts run consult-asr --workdir /tmp/eval-app
```

(Older Node needs a TS loader; the suite-manifest dynamic imports in
`apps/eval/src/suites.ts` rely on type stripping.)

## Composability status

Stage refs are **dispatched**: `eval run` maps the manifest's
`stages` through the domain's run-stage selector
(`runStageSelection`/`RUN_STAGE_FNS` in
`evals/consultation/src/pipeline.ts`) and executes the run-stage
subset (`transcribe`, `cleanup`, `judge`) in declared order. The
canonical dependency order is transcribe → cleanup → judge — a
selection may narrow the pipeline (skip `judge`, transcribe-only)
but never reorder it; generation stages (`script_gen`, `synthesize`)
belong to `eval generate`, and any other non-run stage id fails
`eval run` loudly. Skipped stages persist as absent fields, never
zeroed metrics: no cleanup → no `correctedMetrics`; no judge →
entity verdicts come from the text floor only and every edit verdict
is `unjudged`.

Metric refs are **validated pointers only**: the pipeline emits one
`StageMetrics` record per produced stage (wer/cer/entity verdicts)
because gates consume the entire record — metrics are not
individually dispatched. Metric-level selection is a report-time
concern.

Gate refs **dispatch** through `GATE_DECODERS` in
`apps/eval/src/policy.ts`: manifest `gates[].params` decode to an
`AcceptPolicy` (CLI flags may override individual fields) and
`gateRun`/`decideAutoAccept` consume persisted results. `meta.fn` on
a contribution remains a pointer for humans/ops, not a callable key.
`eval list --strict` still reports unresolved refs.

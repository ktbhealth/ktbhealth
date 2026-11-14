# evals — suite manifests

Pure-data suite manifests (`defineSuite` from `@ktb/eval-core`), one
`*.suite.ts` file per suite, discovered by `apps/eval` (`eval list`,
`eval generate|run|gate|report <suite>`). The `*.suite.ts` suffix is
the manifest convention: any other `.ts` file in this directory is a
shared helper module (fixtures, builders, schemas) and is never
treated as a suite — `eval list` only scans `*.suite.ts`.

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
`plugins/eval-consult/src/pipeline.ts`) and executes the run-stage
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

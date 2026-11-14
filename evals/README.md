# evals — suite manifests

Pure-data suite manifests (`defineSuite` from `@ktb/eval-core`), one
`*.suite.ts` file per suite, discovered by `apps/eval` (`eval list`,
`eval generate|run|gate|report <suite>`). The `*.suite.ts` suffix is
the manifest convention: any other `.ts` file in this directory is a
shared helper module (fixtures, builders, schemas) and is never
treated as a suite — `eval list` only scans `*.suite.ts`.

## Composability status

Stage/metric/gate/capability refs are **validated** against the
contribution registry (`eval list --strict` reports unresolved refs),
but they are **not dispatched**: `meta.fn` on a contribution is a
pointer for humans/ops, not a callable key, and `processSample` runs a
fixed pipeline (transcribe → cleanup → judge) regardless of the
`stages` list. Stage dispatch by contribution id is phase-2 work — see
`packages/eval-core/src/suite.ts`.

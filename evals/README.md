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

Stage/metric/gate/capability refs are **validated** against the
contribution registry (`eval list --strict` reports unresolved refs),
but they are **not dispatched**: `meta.fn` on a contribution is a
pointer for humans/ops, not a callable key, and `processSample` runs a
fixed pipeline (transcribe → cleanup → judge) regardless of the
`stages` list. Stage dispatch by contribution id is phase-2 work — see
`packages/eval-core/src/suite.ts`.

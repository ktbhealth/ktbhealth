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

### Stage DAGs (P-077)

`stages` entries are `StageEntry` = a bare id **or** a `StageNode`
`{id, needs?, optional?, when?}` (`@ktb/eval-core` suite.ts). The
generic machinery lives in `packages/eval-core/src/dag.ts`:

- `needs` absent → depends on **every earlier** entry (the
  linear-chain default — string entries and pre-DAG manifests stay
  sequential); `needs` present → exactly those ids (`needs: []` =
  parallel branch root; forward refs allowed).
- `buildStagePlan` validates (duplicate ids, unknown/self needs,
  cycles → `StageGraphError`) and levels the graph;
  `runStageGraph` executes level-by-level with bounded concurrency,
  collecting per-node outcomes (`ok`/`failed`/`skipped` + reason).
- `when.condition` references a registered `eval.condition`
  contribution; evaluators are injected by the composition root
  (`builtinConditions` ships `nonempty`/`always`/`never`). A false
  condition skips the node and transitively blocks dependents.
- `optional: true` tolerates the node's own failure — dependents
  still run; a failed REQUIRED node skips its dependents.
- Provenance: plan nodes carry `needs` (→ `RunRecord.parents`) and
  `branch` (single root ancestor, absent on merges).

**Consultation is linear-only**: `RUN_STAGE_FNS` share one mutable
`StageRun`, so `eval run` rejects non-linear node features (parallel
`needs`, `when`, `optional`) with a usage error rather than silently
ignoring them. DAG execution is opt-in per domain — a future domain
pack dispatches through `runStageGraph` instead. **Gates evaluate
merged evidence**: gate policies consume per-sample `SampleResult`
rows exactly as before; branch/condition detail lives on
`RunRecord.parents`/`branch` for report-time auditing. Per-branch
gate scoping is future work.

### Cross-suite composition (P-077)

`inputs` declares refs to other suites' persisted artifacts:
`{suite, stage?, field?, runId?, datasetVersion?}`. `eval run`
resolves them (`apps/eval/src/inputs.ts`) against the shared workdir
store — `suite` must exist in evals/ (fatal at run, `! input`
warning + `--strict` failure at `eval list`), `datasetVersion`
defaults to the source suite's pin, `runId` pins an exact prior run,
absent both the newest run wins. `stage`→`field` defaults:
transcribe→`asrText`, cleanup→`correctedText`.

Today the consultation runner consumes exactly one materialized
field: **`asrText` as `priorAsrText`** — a suite omitting
`transcribe` runs cleanup/judge on a prior run's ASR text (mutually
exclusive with a live `transcribe` selection; per-sample misses fail
honestly). Resolved inputs are lineage: the run's `Experiment`
records `derivedFrom` = source run ids and `summary.inputs` = the
resolved refs. Inputs always read ALREADY-PERSISTED results, so
self/cyclic refs degrade to "previous iteration" semantics — allowed
on purpose.

Metric refs are **validated pointers only**: the pipeline emits one
`StageMetrics` record per produced stage (wer/cer/entity verdicts)
because gates consume the entire record — metrics are not
individually dispatched. Metric-level selection is a report-time
concern.

Gate refs **dispatch** through `GATE_DECODERS` in
`apps/eval/src/policy.ts`: each gate's `config` decodes to an
`AcceptPolicy` (CLI flags may override individual fields) and
`gateRun`/`decideAutoAccept` consume persisted results. `meta.fn` on
a contribution remains a pointer for humans/ops, not a callable key.
`eval list --strict` still reports unresolved refs.

**Config expressiveness (P-078).** Stage/metric/gate/condition
entries may carry a `config` JSON object (gates also accept legacy
`params`, normalized to `config` at resolution). The config SHAPE is
contributor-owned: each contribution may declare a `validateConfig`
function beside its registry entry (`ContributionWithConfig` in
`@ktb/eval-core`) — effect/Schema is not JSON-serializable, so
validation is contributor code, never manifest data. `eval list` and
`eval run` run every declared validator at resolution; unknown config
keys are rejected, and config on a validator-less contribution is an
error, never silently accepted. Gate entries may instead name an
`eval.gatepreset` contribution (`{preset, overrides?}`) — a
versioned, named bundle of `{id, config}` gate refs contributed as
data (`meta.gates`); `overrides` shallow-merges per gate id. The
consultation pack ships `consult.standard` and `consult.strict`.
Stage `when.condition` ids resolve as `eval.condition` contributions
— the builtins (`nonempty`/`always`/`never`) are declared alongside
their eval-core evaluators, and domain packs contribute their own
(e.g. `wer-above`).

## Domain definitions (P-079)

A domain pack may ship **`src/domain.ts`** exporting `domain` — a
pure-data `DomainDefinition` (`defineDomain` from `@ktb/eval-core`).
Like `defineSuite`, it validates and throws on malformed input;
`validateDomain`/`validateDomainOverrides` are the nullable helpers
for untrusted imports. The `domain.ts` basename is the convention —
any other file is pack source and is never treated as a definition
(same rule as `*.suite.ts`).

The definition is **data, not behavior**. It declares:

- `id` + `version`, optional `extends` (parent domain id);
- `provides` — contribution refs the domain offers (stages, metrics,
  gates, gatePresets, conditions, configs);
- `locale` (`{profile, tag}`), `templates` (`{dir, name?}` —
  pack-relative), `personas` (matrix dimensions), `phi`
  (`{categories, policy?}`), and open `params` (JSON generator/
  pipeline knobs such as dataset defaults).

**The honest boundary:** everything executable stays code — stage
implementations, metric math, gate evaluation, anonymization
patterns, WER. The definition only names _which_ registered
contributions compose the domain and _which data_ parametrizes
them. `eval-core` never learns domain vocabulary; a domain without
a `domain.ts` keeps working through built-in defaults.

**Inheritance.** `extends` resolves child→parent over the discovered
definitions (`apps/eval/src/domains.ts`): unknown ids, unknown
parents, and cycles are resolution errors. Merge semantics:

- contribution lists **union by id** — the child's entry wins on
  collision;
- named sections (locale/templates/personas/phi) — child wins per
  section;
- `params` **deep-merge** recursively — plain objects merge,
  scalars/arrays replace; suite `domainParams` apply last.

**Suite overrides.** A manifest may carry `domainParams` (a partial
`DomainDefinition`-shaped JSON object, validated by
`validateDomainOverrides` — unknown top-level sections are
rejected). `apps/eval` merges domain params + suite overrides and
threads the result as `domainParams` into `generateDataset`
(dataset defaults: count/step/seed/noise) and `processSample`
(`params.entityCategories` filters judged entity categories, etc.).
Flags (`--n`, `--seed`, `--noise`, `--locale`, `--personas`,
`--template`) still win over both. `eval list` prints the resolved
definition (`domain-def <id> v<n> · k param key(s)`) and counts
resolution errors under `--strict`; a _missing_ definition is only
a `! domain` note, never a strict failure — legacy/fallback suites
stay legal.

Consultation's definition lives at
`evals/consultation/src/domain.ts` (`eval.consultation`): pt-BR
locale `ptbr-v1`, `templates/pt-BR`, the default persona matrix,
PHI categories, and dataset defaults `{count: 8, step: 7, seed:
100, noise: "clean"}`. `consult-asr.suite.ts` declares
`domain: "eval.consultation"` and needs no `domainParams` — its
behavior already equals the domain defaults; a specialization (e.g.
a stricter cohort or an entity-category subset) adds a
`domainParams` block without touching the pack. A new locale or a
consultation specialization is a new `domain.ts` (optionally
`extends: "eval.consultation"`) — no pipeline fork.

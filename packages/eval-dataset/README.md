# @ktb/eval-dataset

Domain package for the transcription **eval platform** (P-066, T-042).
Pure domain + Effect ports — no platform APIs, no provider literals
(enforced by `tools/arch-policy.mjs`).

## What it does

Measures the transcription pipeline in **separate stages** — raw ASR →
LLM cleanup → physician-approved → anamnesis — so gains and regressions
are attributable. Built for a hybrid dataset: `synthetic` (TTS) today,
`real_anonymized` later (LGPD provenance gate enforced by Schema).

## Modules

| file           | contents                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`    | `Sample` manifest, `Persona`, `Gold` (+ persisted expected entities), `Provenance`, `RunRecord`, `EditList`/`EditOp`, `EditVerdict` (incl. `unjudged`), `ConfSegment`, `SampleResult` |
| `ports.ts`     | `TtsPort`, `AsrPort`, `LlmPort` (TaskEnvelope), `EvalPort` (typed judge: noul/choice/score), `DatasetStorePort`, `ReportPort` — every op returns a `RunRecord`                        |
| `diff.ts`      | Reversible word-level edit lists (`applyEdits`/`revertEdits` validate `remove` content → `EditApplyError`), RAM-capped LCS                                                            |
| `metrics.ts`   | pt-BR-aware `normalize` (NFC, numeral words, decimal-dosage guard, speaker labels), `wer`/`cer`, clinical entity checks, confidence buckets, precision-first `recommendThreshold`     |
| `pipeline.ts`  | `generateScript`, `processSample` — per-stage entity verdicts with judge-state isolation, persisted results                                                                           |
| `personas.ts`  | Persona matrix (region × age × register × specialty = 180 cells)                                                                                                                      |
| `anonymize.ts` | PHI scrubber (`anonymize`) + ingest gate (`gateTranscript`) for `real_anonymized` transcripts — counts-only audit, never retains redacted values                                      |

## PHI enforcement (M4)

- `processSample` re-runs `gateTranscript` on `real_anonymized`
  scripts before any port call and **fails closed** on residual
  identifiers; downstream stages (judge state, metrics) see the
  scrubbed text. `anonymize`/`gateTranscript` themselves only return
  audit counts / null — they never fail anything.
- `AsrPort.transcribe` receives `sample.origin` so adapters that
  egress audio can enforce the boundary: cloud ASR must only ever see
  synthetic audio (voice is PHI). `@ktb/eval-dataset-cloud` refuses
  declared `real_anonymized` audio unless `allowRealAudio` is set for
  a self-hosted endpoint.
- Residual gap (explicit): a caller that bypasses the port and hands a
  raw `AudioRef` with no provenance is outside the adapter guarantee —
  audio-level provenance markers land with the real-ingest milestone.

## Boundary rules

Adapters live in `@ktb/eval-dataset-{stub,local,cloud}`. Generative work
runs as ACP task envelopes — never direct SDK calls. Typesafe.ai/Jev
literals are banned here; they belong in the Eval adapter.

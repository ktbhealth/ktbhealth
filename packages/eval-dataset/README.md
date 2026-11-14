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

| file                     | contents                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema.ts`              | `Sample` manifest, `Persona`, `Gold` (+ persisted expected entities), `Provenance`, `RunRecord`, `EditList`/`EditOp`, `EditVerdict` (incl. `unjudged`), `ConfSegment`, `SampleResult`                                                                                                |
| `ports.ts`               | `TtsPort`, `AsrPort`, `LlmPort` (TaskEnvelope), `EvalPort` (typed judge: noul/choice/score), `DatasetStorePort`, `ReportPort` — every op returns a `RunRecord`                                                                                                                       |
| `diff.ts`                | Reversible word-level edit lists (`applyEdits`/`revertEdits` validate `remove` content → `EditApplyError`), RAM-capped LCS                                                                                                                                                           |
| `metrics.ts`             | locale-aware `normalize` (NFC, numeral words, decimal-dosage guard, speaker labels — all via `LocaleProfile`, default pt-BR), `wer`/`cer`, clinical entity checks, confidence buckets, precision-first `recommendThreshold`                                                          |
| `locale.ts` + `locales/` | `LocaleProfile` port (T-118): number words, speaker labels, decimal word, ASR language, PHI patterns, script slot tables. `ptBR` (`ptbr-v1`) is the default; `.eta` templates live under `templates/<locale-tag>/`. Second locale = new profile + new template dir — no core changes |
| `pipeline.ts`            | `generateScript`, `processSample` — per-stage entity verdicts with judge-state isolation, persisted results; `profile.id` is stored as `StageMetrics.normalization`                                                                                                                  |
| `personas.ts`            | Persona matrix (region × age × register × specialty = 180 cells); axis values are English literals but the region list is Brazilian — a second locale ships its own matrix alongside its profile                                                                                     |
| `anonymize.ts`           | PHI scrubber (`anonymize`) + ingest gate (`gateTranscript`) for `real_anonymized` transcripts — patterns are locale data (`profile.piiPatterns`), counts-only audit, never retains redacted values                                                                                   |

## PHI enforcement (M4)

- `processSample` re-runs `gateTranscript` on `real_anonymized`
  scripts before any port call and **fails closed** on residual
  identifiers; downstream stages (judge state, metrics) see the
  scrubbed text. `anonymize`/`gateTranscript` themselves only return
  audit counts / null — they never fail anything.
- `AsrPort.transcribe` receives `sample.origin` (caller-declared) AND
  `blobMeta` — the provenance recorded on the blob itself. `processSample`
  resolves it via `DatasetStorePort.getBlobMeta` before every transcribe;
  a failed lookup fails closed. Adapters that egress audio must treat
  stored `real_anonymized`/`unknown` as non-synthetic: cloud ASR refuses
  them unless `allowRealAudio` is set for a self-hosted endpoint.
- `DatasetStorePort.putBlob(uri, bytes, meta?)` persists provenance
  WITH the bytes (`getBlobMeta` reads it back). Omitting `meta` records
  `unknown` — conservative, never silently synthetic. Both real
  adapters (SQLite `blob_meta` table, R2 `blobmeta/` objects) write the
  meta record before the bytes so a stored blob always has provenance.
- Residual gap (explicit): a caller that hands a raw `AudioRef` whose
  URI has NO store record — e.g. a `file://` path resolved directly by
  the adapter's `readAudio` — is outside the guarantee; the store
  cannot see bytes it never stored. `blobMeta: null`/absent meta is
  the documented bypass, not a verified-synthetic claim.

## Boundary rules

Adapters live in `@ktb/eval-dataset-{stub,local,cloud}`. Generative work
runs as ACP task envelopes — never direct SDK calls. Typesafe.ai/Jev
literals are banned here; they belong in the Eval adapter.

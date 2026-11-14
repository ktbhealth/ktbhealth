# @ktb/eval-adapter-local

Local adapters for the eval platform: dataset store on **SQLite +
filesystem blobs**, reports as **JSONL/Markdown** on disk.

## Layers

```ts
makeLocalStoreLayer(root); // DatasetStorePort — {root}/manifest.sqlite + {root}/blobs/
makeLocalReportLayer(file); // ReportPort — appends run.jsonl; render returns the markdown table (same shape as the stub)
```

Store properties: WAL + `busy_timeout`, atomic blob writes (tmp +
rename), URI-hashed blob filenames, `putSample` re-decodes through the
Schema (the `real_anonymized` provenance gate applies on **write** as
well as read). `putBlob(uri, bytes, meta?)` also persists provenance
in a `blob_meta` SQLite table (`getBlobMeta` reads it; omitted `meta`
records `unknown`). Requires an Effect `Scope` (closes the DB handle).

**Blob asymmetry (intentional):** TTS audio is written to
`<workdir>/tts/audio/*.wav` and referenced by `file://` AudioRefs —
the bytes never enter the blob store, only their provenance does
(`putBlobMeta`). `getBlob(file://…)` therefore returns `null` for the
dataset's own audio; consumers that need those bytes read the path
directly (the cloud ASR adapter's injected `readAudio` does exactly
that, confined to the run workdir). `getBlob`/`putBlob` serve blobs
that ARE stored — ingest pipelines, not generated audio.

## Eval judge adapters

- `makeJevEval` — hosted Jev decision service (`EVAL_JEV_URL`).
- `makeSystemOneEval` — any server speaking the TypeSafe
  `POST /v1/systemone` wire shape: object-keyed typed questions
  (noul/choice/score) in, calibrated probabilities out. Self-hosted
  options: **OpenJev** (`pip install "openjev-ai[serve]"` then
  `wev serve --model alanhuangya/OpenJev-4B --port 8009`),
  razorback16/openjev (vLLM/MLX), amithgc/local-jev.

  ```sh
  wev serve --model alanhuangya/OpenJev-4B --port 8009
  EVAL_SYSTEMONE_URL=http://127.0.0.1:8009 \
    bun apps/eval/src/cli.ts run <suite> --profile local-systemone
  ```

  `EVAL_SYSTEMONE_MODEL` is optional — self-hosted servers treat the
  `model` field as opaque (OpenJev defaults it to `wev-latest`); set
  it only for endpoints that validate model names. `egress`
  auto-derives from the baseUrl (loopback = local-only).

  **License note:** `wev-ai`/`openjev-ai` and the OpenJev-4B weights
  are Apache-2.0 per the Hugging Face model card — still verify the
  license of any specific model revision before redistributing
  weights or using them in production.

## Scripts

- `scripts/bench/` — the ASR Pareto benchmark (edge-tts →
  faster-whisper → WER). See `scripts/bench/BENCHMARK.md` for method,
  results and reproduction steps. `scripts/asr-server.py` is the
  faster-whisper sidecar `makeLocalAsr` spawns (EVAL_ASR_URL).

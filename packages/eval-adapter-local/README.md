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

## Scripts

- `scripts/bench/` — the ASR Pareto benchmark (edge-tts →
  faster-whisper → WER). See `scripts/bench/BENCHMARK.md` for method,
  results and reproduction steps. `scripts/asr-server.py` is the
  faster-whisper sidecar `makeLocalAsr` spawns (EVAL_ASR_URL).

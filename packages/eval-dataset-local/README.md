# @ktb/eval-dataset-local

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
well as read). Requires an Effect `Scope` (closes the DB handle).

## Scripts

- `bun scripts/demo.ts <outDir>` — end-to-end stub pipeline:
  persona matrix → ASR/cleanup/judge → persisted samples, blobs,
  per-stage RunRecords and results. `outDir` must live under a `tmp/`
  path and is **deleted and recreated** on every run.
- `scripts/bench/` — the ASR Pareto benchmark (edge-tts →
  faster-whisper → WER). See `scripts/bench/BENCHMARK.md` for method,
  results and reproduction steps.

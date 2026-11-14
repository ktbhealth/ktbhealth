# @ktb/eval-dataset-cloud

Cloud adapters for the eval platform: **Workers AI** ASR and an
**R2-compatible** object store for manifests, blobs and results.

## Layers

```ts
makeWorkersAiAsr({
	accountId,
	apiToken,
	model, // e.g. an ASR model alias — required, no hidden default
	readAudio, // (uri) => Effect<Uint8Array, PortError> — you own blob resolution
	readBlobMeta, // optional: (uri) => store.getBlobMeta — stored-provenance lookup
	// endpoint, fetchImpl, timeoutMs, retry are injectable for tests/mocks
});

makeR2Store(bucket); // DatasetStorePort — samples/, blobs/, blobmeta/, results/ prefixes
```

`BucketLike` is the narrow R2 surface (`get`/`put`/`list` with cursor
pagination) — a real `R2Bucket` binding, the REST API, or an in-memory
fake all fit without changes.

## PHI boundary (LGPD)

- **ASR**: audio bytes leave the process for Cloudflare. Voice is PHI —
  `transcribe` refuses non-synthetic audio on TWO channels: the
  caller-declared `origin` AND the provenance stored on the blob
  (`callOpts.blobMeta` from the pipeline, or the `readBlobMeta`
  lookup). Stored `real_anonymized`/`unknown` both refuse unless
  `allowRealAudio: true` is set, and that flag is only for endpoints
  you operate yourself (self-hosted Workers-AI-compatible
  mock/proxy), never the public API. Only verified-`synthetic` blobs
  may leave.
- **Residual bypass (documented)**: an `AudioRef` whose URI has no
  store record — `blobMeta` null/absent — cannot be verified, so the
  adapter falls back to the declared-origin check. `file://` paths
  resolved directly by `readAudio`, or any caller that skips both
  provenance channels, are the operator's responsibility: route audio
  through `putBlob` with `{ origin: "synthetic" }` (or wire
  `readBlobMeta`) before it reaches this adapter.
- **Store**: `putBlob(uri, bytes, meta?)` writes the provenance record
  (`blobmeta/<uri>.json`) BEFORE the bytes, so every stored blob has
  meta — omitting `meta` records `unknown`, which cloud ASR refuses.
  `putSample`/`putResult` re-decode through the Schema
  before writing, so the `real_anonymized` provenance filter
  (`sourcePartner`, `anonymizationMethod`, `consentRef`, `lgpdBasis`)
  fires on write — a non-compliant row can never be persisted.
- **Scripts**: `processSample` re-runs `gateTranscript` on
  `real_anonymized` scripts before any stage and fails closed on
  residual identifiers; downstream stages see the scrubbed text.

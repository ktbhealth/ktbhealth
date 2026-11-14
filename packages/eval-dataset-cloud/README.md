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
	// endpoint, fetchImpl, timeoutMs, retry are injectable for tests/mocks
});

makeR2Store(bucket); // DatasetStorePort — samples/, blobs/, results/ prefixes
```

`BucketLike` is the narrow R2 surface (`get`/`put`/`list` with cursor
pagination) — a real `R2Bucket` binding, the REST API, or an in-memory
fake all fit without changes.

## PHI boundary (LGPD)

- **ASR**: audio bytes leave the process for Cloudflare. Voice is PHI —
  `transcribe` refuses `origin: "real_anonymized"` audio unless
  `allowRealAudio: true` is set, and that flag is only for endpoints
  you operate yourself (self-hosted Workers-AI-compatible mock/proxy),
  never the public API. The domain pipeline passes `sample.origin`
  through `AsrPort.transcribe` opts; callers that bypass the port and
  hand a raw `AudioRef` are outside this guarantee — ingest-side
  provenance enforcement is tracked separately.
- **Store**: `putSample`/`putResult` re-decode through the Schema
  before writing, so the `real_anonymized` provenance filter
  (`sourcePartner`, `anonymizationMethod`, `consentRef`, `lgpdBasis`)
  fires on write — a non-compliant row can never be persisted.
- **Scripts**: `processSample` re-runs `gateTranscript` on
  `real_anonymized` scripts before any stage and fails closed on
  residual identifiers; downstream stages see the scrubbed text.

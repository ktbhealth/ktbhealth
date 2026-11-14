/**
 * r2.ts — DatasetStorePort over an R2-style object store (M4).
 *
 * Layout: samples/{id}.json, blobs/{uri}, results/{runId}/{sampleId}.json.
 * The bucket is a narrow injected interface (R2Bucket-compatible:
 * get/put/list) so the adapter runs against a real binding, the REST
 * API, or an in-memory fake with zero changes. Listing is the source
 * of truth — no sidecar index to drift.
 *
 * Scale note: listSamples/listResults list every key under the prefix
 * and GET each object (concurrency 8), filtering client-side — O(N)
 * reads per call. That is deliberate at eval-dataset scale (hundreds
 * of rows per run); results keys are already partitioned by runId, so
 * a `runId` filter narrows the prefix. If a deployment outgrows this,
 * push sample filters into the key layout or add a sidecar index —
 * the port shape has no pagination today.
 */

import { Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
	BlobMeta,
	CalibrationReport,
	DatasetManifest,
	EvalStorePort,
	Experiment,
	PortError,
} from "@ktb/eval-core";
import { DatasetStorePort, Sample, SampleResult } from "@ktb/eval-consultation";

/** Minimal R2 surface — structurally compatible with R2Bucket. */
export interface BucketLike {
	get(
		key: string,
	): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> } | null>;
	put(key: string, value: ArrayBuffer | string): Promise<unknown>;
	list(opts?: {
		prefix?: string;
	}): Promise<{ objects: readonly { key: string }[]; truncated: boolean; cursor?: string }>;
}

const fail = (message: string) => new PortError({ port: "store", message });
const decodeSample = Schema.decodeUnknownSync(Sample);
const decodeResult = Schema.decodeUnknownSync(SampleResult);
const decodeBlobMeta = Schema.decodeUnknownSync(BlobMeta);
const decodeExperiment = Schema.decodeUnknownSync(Experiment);
const decodeDatasetManifest = Schema.decodeUnknownSync(DatasetManifest);
const decodeCalibration = Schema.decodeUnknownSync(CalibrationReport);

const getJson = (bucket: BucketLike, key: string) =>
	Effect.tryPromise({
		try: async () => {
			const obj = await bucket.get(key);
			return obj === null ? null : JSON.parse(await obj.text());
		},
		catch: (e) => fail(e instanceof Error ? e.message : String(e)),
	});

const putJson = (bucket: BucketLike, key: string, value: unknown) =>
	Effect.tryPromise({
		try: () => bucket.put(key, JSON.stringify(value)).then(() => undefined),
		catch: (e) => fail(e instanceof Error ? e.message : String(e)),
	});

/** Paginated full listing of a prefix. */
const listKeys = (bucket: BucketLike, prefix: string) =>
	Effect.tryPromise({
		try: async () => {
			const keys: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await bucket.list({ prefix, ...(cursor !== undefined ? { cursor } : {}) });
				keys.push(...page.objects.map((o) => o.key));
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor !== undefined);
			return keys;
		},
		catch: (e) => fail(e instanceof Error ? e.message : String(e)),
	});

export const makeR2Store = (bucket: BucketLike): Layer.Layer<DatasetStorePort> =>
	Layer.succeed(
		DatasetStorePort,
		DatasetStorePort.of({
			// Write-side decode, same as the local store: the Sample
			// Schema's provenance filter fires HERE, so a real_anonymized
			// row missing LGPD fields is rejected before it can poison
			// every later read. The validated value is what gets stored.
			putSample: (sample) =>
				Effect.try({
					try: () => decodeSample(sample),
					catch: (e) => fail(`invalid sample: ${String(e).slice(0, 200)}`),
				}).pipe(
					Effect.flatMap((validated) => putJson(bucket, `samples/${validated.id}.json`, validated)),
				),

			getSample: (id) =>
				getJson(bucket, `samples/${id}.json`).pipe(
					Effect.flatMap((body) =>
						body === null
							? Effect.succeed(null)
							: Effect.try({
									try: () => decodeSample(body),
									catch: (e) => fail(`corrupt sample ${id}: ${String(e).slice(0, 200)}`),
								}),
					),
				),

			listSamples: (filter) =>
				listKeys(bucket, "samples/").pipe(
					Effect.flatMap((keys) =>
						Effect.forEach(keys, (k) => getJson(bucket, k), { concurrency: 8 }),
					),
					Effect.flatMap((bodies) =>
						Effect.try({
							try: () =>
								bodies
									.filter((b): b is NonNullable<typeof b> => b !== null)
									.map((b) => decodeSample(b))
									.filter(
										(s) =>
											(filter?.origin === undefined || s.origin === filter.origin) &&
											(filter?.datasetVersion === undefined ||
												s.datasetVersion === filter.datasetVersion),
									),
							catch: (e) => fail(`corrupt sample in store: ${String(e).slice(0, 200)}`),
						}),
					),
				),

			// Write-side decode, same as putSample: a bogus origin fails
			// here, not silently at read. The meta object lands BEFORE
			// the bytes so every stored blob carries a provenance
			// record — a failed blob write leaves a conservative orphan
			// meta, never an unmarked blob cloud ASR could mistake for
			// the documented no-record bypass.
			putBlob: (uri, bytes, meta) =>
				Effect.try({
					try: () => decodeBlobMeta({ origin: meta?.origin ?? "unknown" }),
					catch: (e) => fail(`invalid blob meta: ${String(e).slice(0, 200)}`),
				}).pipe(
					Effect.flatMap((validated) =>
						Effect.tryPromise({
							try: async () => {
								const enc = encodeURIComponent(uri);
								await bucket.put(`blobmeta/${enc}.json`, JSON.stringify(validated));
								// Copy — detaches the view from any shared/oversized buffer.
								await bucket.put(`blobs/${enc}`, new Uint8Array(bytes).buffer);
							},
							catch: (e) => fail(e instanceof Error ? e.message : String(e)),
						}),
					),
				),

			// Meta-only registration — same contract as putBlob minus
			// the bytes write, for blobs produced outside the store.
			putBlobMeta: (uri, meta) =>
				Effect.try({
					try: () => decodeBlobMeta({ origin: meta?.origin ?? "unknown" }),
					catch: (e) => fail(`invalid blob meta: ${String(e).slice(0, 200)}`),
				}).pipe(
					Effect.flatMap((validated) =>
						Effect.tryPromise({
							try: () =>
								bucket
									.put(`blobmeta/${encodeURIComponent(uri)}.json`, JSON.stringify(validated))
									.then(() => undefined),
							catch: (e) => fail(e instanceof Error ? e.message : String(e)),
						}),
					),
				),

			getBlobMeta: (uri) =>
				getJson(bucket, `blobmeta/${encodeURIComponent(uri)}.json`).pipe(
					Effect.flatMap((body) =>
						body === null
							? Effect.succeed(null)
							: Effect.try({
									try: () => decodeBlobMeta(body),
									catch: (e) => fail(`corrupt blob meta ${uri}: ${String(e).slice(0, 200)}`),
								}),
					),
				),

			getBlob: (uri) =>
				Effect.tryPromise({
					try: async () => {
						const obj = await bucket.get(`blobs/${encodeURIComponent(uri)}`);
						return obj === null ? null : new Uint8Array(await obj.arrayBuffer());
					},
					catch: (e) => fail(e instanceof Error ? e.message : String(e)),
				}),

			// Same write-side decode as putSample — a malformed row fails
			// here, not silently at listResults. Key segments are
			// percent-encoded: a runId/sampleId containing "/" must not
			// escape the results/ prefix into nested keys (same rule as
			// blobs/blobmeta, which already encodeURIComponent the uri).
			putResult: (result) =>
				Effect.try({
					try: () => decodeResult(result),
					catch: (e) => fail(`invalid result: ${String(e).slice(0, 200)}`),
				}).pipe(
					Effect.flatMap((validated) =>
						putJson(
							bucket,
							`results/${encodeURIComponent(validated.runId)}/${encodeURIComponent(validated.sampleId)}.json`,
							validated,
						),
					),
				),

			listResults: (filter) =>
				// runId is a key path segment — narrowing the prefix skips
				// every other run's objects (still O(N) within the run).
				listKeys(
					bucket,
					filter?.runId !== undefined ? `results/${encodeURIComponent(filter.runId)}/` : "results/",
				).pipe(
					Effect.flatMap((keys) =>
						Effect.forEach(keys, (k) => getJson(bucket, k), { concurrency: 8 }),
					),
					Effect.flatMap((bodies) =>
						Effect.try({
							try: () =>
								bodies
									.filter((b): b is NonNullable<typeof b> => b !== null)
									.map((b) => decodeResult(b))
									.filter(
										(r) =>
											(filter?.sampleId === undefined || r.sampleId === filter.sampleId) &&
											(filter?.runId === undefined || r.runId === filter.runId),
									),
							catch: (e) => fail(`corrupt result in store: ${String(e).slice(0, 200)}`),
						}),
					),
				),
		}),
	);

/** EvalStorePort over the same bucket — the framework-level
 * artifact collections (P-076):
 *
 *   experiments/<id>.json
 *   datasets/<id>/<version>.json      (registry — contentHash-pinned)
 *   calibrations/<id>.json
 *
 * Same contract as makeR2Store: write-side schema decode, listing is
 * the source of truth, O(N) GETs per list call — fine at eval scale.
 * putDatasetManifest enforces registry uniqueness: same id+version
 * with a different contentHash is a PortError, identical is a no-op. */
export const makeR2EvalStore = (bucket: BucketLike): Layer.Layer<EvalStorePort> =>
	Layer.succeed(
		EvalStorePort,
		EvalStorePort.of({
			putExperiment: (experiment) =>
				Effect.try({
					try: () => decodeExperiment(experiment),
					catch: (e) => fail(`invalid experiment: ${String(e).slice(0, 200)}`),
				}).pipe(
					Effect.flatMap((validated) =>
						putJson(bucket, `experiments/${encodeURIComponent(validated.id)}.json`, validated),
					),
				),

			getExperiment: (id) =>
				getJson(bucket, `experiments/${encodeURIComponent(id)}.json`).pipe(
					Effect.flatMap((body) =>
						body === null
							? Effect.succeed(null)
							: Effect.try({
									try: () => decodeExperiment(body),
									catch: (e) => fail(`corrupt experiment ${id}: ${String(e).slice(0, 200)}`),
								}),
					),
				),

			listExperiments: (filter) =>
				listKeys(bucket, "experiments/").pipe(
					Effect.flatMap((keys) =>
						Effect.forEach(keys, (k) => getJson(bucket, k), { concurrency: 8 }),
					),
					Effect.flatMap((bodies) =>
						Effect.try({
							try: () =>
								bodies
									.filter((b): b is NonNullable<typeof b> => b !== null)
									.map((b) => decodeExperiment(b))
									.filter((e) => filter?.suiteId === undefined || e.suiteId === filter.suiteId),
							catch: (e) => fail(`corrupt experiment in store: ${String(e).slice(0, 200)}`),
						}),
					),
				),

			putDatasetManifest: (manifest) =>
				Effect.try({
					try: () => decodeDatasetManifest(manifest),
					catch: (e) => fail(`invalid dataset manifest: ${String(e).slice(0, 200)}`),
				}).pipe(
					Effect.flatMap((validated) =>
						Effect.gen(function* () {
							const key = `datasets/${encodeURIComponent(validated.id)}/${encodeURIComponent(validated.version)}.json`;
							const existing = yield* getJson(bucket, key);
							if (existing !== null) {
								const prior = yield* Effect.try({
									try: () => decodeDatasetManifest(existing),
									catch: (e) => fail(`corrupt dataset manifest ${key}: ${String(e).slice(0, 200)}`),
								});
								if (prior.contentHash !== validated.contentHash) {
									return yield* fail(
										`dataset ${validated.id}@${validated.version} already registered ` +
											`with contentHash ${prior.contentHash} — refusing to overwrite ` +
											`with ${validated.contentHash}; bump the suite's dataset version`,
									);
								}
								return; // identical re-registration — idempotent
							}
							yield* putJson(bucket, key, validated);
						}),
					),
				),

			getDatasetManifest: (id, version) =>
				getJson(
					bucket,
					`datasets/${encodeURIComponent(id)}/${encodeURIComponent(version)}.json`,
				).pipe(
					Effect.flatMap((body) =>
						body === null
							? Effect.succeed(null)
							: Effect.try({
									try: () => decodeDatasetManifest(body),
									catch: (e) =>
										fail(`corrupt dataset manifest ${id}@${version}: ${String(e).slice(0, 200)}`),
								}),
					),
				),

			listDatasetManifests: () =>
				listKeys(bucket, "datasets/").pipe(
					Effect.flatMap((keys) =>
						Effect.forEach(keys, (k) => getJson(bucket, k), { concurrency: 8 }),
					),
					Effect.flatMap((bodies) =>
						Effect.try({
							try: () =>
								bodies
									.filter((b): b is NonNullable<typeof b> => b !== null)
									.map((b) => decodeDatasetManifest(b)),
							catch: (e) => fail(`corrupt dataset manifest in store: ${String(e).slice(0, 200)}`),
						}),
					),
				),

			putCalibrationReport: (report) =>
				Effect.try({
					try: () => decodeCalibration(report),
					catch: (e) => fail(`invalid calibration report: ${String(e).slice(0, 200)}`),
				}).pipe(
					Effect.flatMap((validated) =>
						putJson(bucket, `calibrations/${encodeURIComponent(validated.id)}.json`, validated),
					),
				),

			listCalibrationReports: (filter) =>
				listKeys(bucket, "calibrations/").pipe(
					Effect.flatMap((keys) =>
						Effect.forEach(keys, (k) => getJson(bucket, k), { concurrency: 8 }),
					),
					Effect.flatMap((bodies) =>
						Effect.try({
							try: () =>
								bodies
									.filter((b): b is NonNullable<typeof b> => b !== null)
									.map((b) => decodeCalibration(b))
									.filter(
										(c) =>
											(filter?.suiteId === undefined || c.suiteId === filter.suiteId) &&
											(filter?.runId === undefined || c.runId === filter.runId),
									),
							catch: (e) => fail(`corrupt calibration report in store: ${String(e).slice(0, 200)}`),
						}),
					),
				),
		}),
	);

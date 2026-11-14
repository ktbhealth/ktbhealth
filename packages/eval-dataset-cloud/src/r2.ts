/**
 * r2.ts — DatasetStorePort over an R2-style object store (M4).
 *
 * Layout: samples/{id}.json, blobs/{uri}, results/{sampleId}.json.
 * The bucket is a narrow injected interface (R2Bucket-compatible:
 * get/put/list) so the adapter runs against a real binding, the REST
 * API, or an in-memory fake with zero changes. Listing is the source
 * of truth — no sidecar index to drift.
 */

import { Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DatasetStorePort, PortError, Sample, SampleResult } from "@ktb/eval-dataset";

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

			putBlob: (uri, bytes) =>
				Effect.tryPromise({
					try: () =>
						// Copy — detaches the view from any shared/oversized buffer.
						bucket
							.put(`blobs/${encodeURIComponent(uri)}`, new Uint8Array(bytes).buffer)
							.then(() => undefined),
					catch: (e) => fail(e instanceof Error ? e.message : String(e)),
				}),

			getBlob: (uri) =>
				Effect.tryPromise({
					try: async () => {
						const obj = await bucket.get(`blobs/${encodeURIComponent(uri)}`);
						return obj === null ? null : new Uint8Array(await obj.arrayBuffer());
					},
					catch: (e) => fail(e instanceof Error ? e.message : String(e)),
				}),

			// Same write-side decode as putSample — a malformed row fails
			// here, not silently at listResults.
			putResult: (result) =>
				Effect.try({
					try: () => decodeResult(result),
					catch: (e) => fail(`invalid result: ${String(e).slice(0, 200)}`),
				}).pipe(
					Effect.flatMap((validated) =>
						putJson(bucket, `results/${validated.runId}/${validated.sampleId}.json`, validated),
					),
				),

			listResults: (filter) =>
				listKeys(bucket, "results/").pipe(
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

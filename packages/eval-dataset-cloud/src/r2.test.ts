import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { DatasetStorePort, type Sample, type SampleResult } from "@ktb/eval-dataset";

import { type BucketLike, makeR2Store } from "./r2.ts";

/** In-memory R2 fake — honours prefix + cursor pagination. */
const memBucket = (pageSize = 100): BucketLike => {
	const objects = new Map<string, string | ArrayBuffer>();
	return {
		get: (key) => {
			const v = objects.get(key);
			if (v === undefined) return Promise.resolve(null);
			return Promise.resolve({
				text: () => Promise.resolve(typeof v === "string" ? v : new TextDecoder().decode(v)),
				arrayBuffer: () =>
					Promise.resolve(
						typeof v === "string" ? (new TextEncoder().encode(v).buffer as ArrayBuffer) : v,
					),
			});
		},
		put: (key, value) => {
			objects.set(key, value);
			return Promise.resolve({});
		},
		list: (opts) => {
			const keys = [...objects.keys()].filter((k) => k.startsWith(opts?.prefix ?? "")).sort();
			const cursor = (opts as { cursor?: string } | undefined)?.cursor;
			const start = cursor !== undefined ? Number(cursor) : 0;
			const page = keys.slice(start, start + pageSize);
			const truncated = start + pageSize < keys.length;
			return Promise.resolve({
				objects: page.map((key) => ({ key })),
				truncated,
				...(truncated ? { cursor: String(start + pageSize) } : {}),
			});
		},
	};
};

const sample: Sample = {
	id: "s1",
	datasetVersion: "v1",
	// real_anonymized requires the LGPD provenance gate — good, exercise it.
	origin: "real_anonymized",
	script: "anamnese",
	scriptHash: "h",
	persona: {
		region: "southeast",
		ageBand: "adult",
		register: "formal",
		specialty: "general_practice",
	},
	gold: { validatedBy: "generator" },
	provenance: {
		sourcePartner: "clinic-x",
		anonymizationMethod: "phi-scrub-v1",
		consentRef: "consent-2024-001",
		lgpdBasis: "legitimate_interest",
	},
};

const result: SampleResult = {
	runId: "run-1",
	sampleId: "s1",
	asrText: "texto",
	editVerdicts: [],
	confSegments: [],
	createdAt: 0,
};

const withStore = <A>(e: Effect.Effect<A, unknown, DatasetStorePort>, bucket = memBucket()) =>
	Effect.runPromise(e.pipe(Effect.provide(makeR2Store(bucket))));

describe("r2 store adapter", () => {
	it("put/get/list samples round-trip with filters", async () => {
		const out = await withStore(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				yield* store.putSample(sample);
				yield* store.putSample({ ...sample, id: "s2", origin: "synthetic", datasetVersion: "v2" });
				const got = yield* store.getSample("s1");
				const all = yield* store.listSamples();
				const real = yield* store.listSamples({ origin: "real_anonymized" });
				const v2 = yield* store.listSamples({ datasetVersion: "v2" });
				return { got, all, real, v2 };
			}),
		);
		expect(out.got?.id).toBe("s1");
		expect(out.all).toHaveLength(2);
		expect(out.real.map((s) => s.id)).toEqual(["s1"]);
		expect(out.v2.map((s) => s.id)).toEqual(["s2"]);
	});

	it("returns null for a missing sample", async () => {
		const got = await withStore(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				return yield* store.getSample("nope");
			}),
		);
		expect(got).toBeNull();
	});

	it("blob round-trip and missing blob", async () => {
		const out = await withStore(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				yield* store.putBlob("r2://audio/x.wav", new Uint8Array([1, 2, 3]));
				return {
					hit: yield* store.getBlob("r2://audio/x.wav"),
					miss: yield* store.getBlob("r2://audio/y.wav"),
				};
			}),
		);
		expect([...out.hit!]).toEqual([1, 2, 3]);
		expect(out.miss).toBeNull();
	});

	it("blob provenance round-trips; missing meta defaults to unknown", async () => {
		const out = await withStore(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				yield* store.putBlob("r2://a/syn.wav", new Uint8Array([1]), { origin: "synthetic" });
				yield* store.putBlob("r2://a/real.wav", new Uint8Array([2]), {
					origin: "real_anonymized",
				});
				yield* store.putBlob("r2://a/none.wav", new Uint8Array([3]));
				return {
					syn: yield* store.getBlobMeta("r2://a/syn.wav"),
					real: yield* store.getBlobMeta("r2://a/real.wav"),
					none: yield* store.getBlobMeta("r2://a/none.wav"),
					missing: yield* store.getBlobMeta("r2://a/missing.wav"),
				};
			}),
		);
		expect(out.syn).toEqual({ origin: "synthetic" });
		expect(out.real).toEqual({ origin: "real_anonymized" });
		expect(out.none).toEqual({ origin: "unknown" });
		expect(out.missing).toBeNull();
	});

	it("rejects a bogus blob origin on write", async () => {
		await expect(
			withStore(
				Effect.flatMap(DatasetStorePort, (s) =>
					s.putBlob("u", new Uint8Array(), { origin: "bogus" as never }),
				),
			),
		).rejects.toThrow(/invalid blob meta/);
	});

	it("fails typed on a corrupt stored blob meta", async () => {
		const bucket = memBucket();
		await bucket.put("blobmeta/corrupt.json", '{"origin":42}');
		await expect(
			withStore(
				Effect.gen(function* () {
					const store = yield* DatasetStorePort;
					return yield* store.getBlobMeta("corrupt");
				}),
				bucket,
			),
		).rejects.toThrow(/corrupt blob meta/);
	});

	it("put/list results with runId + sampleId filters", async () => {
		const out = await withStore(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				yield* store.putResult(result);
				yield* store.putResult({ ...result, runId: "run-2", sampleId: "s9" });
				return {
					all: yield* store.listResults(),
					byRun: yield* store.listResults({ runId: "run-2" }),
					bySample: yield* store.listResults({ sampleId: "s1" }),
				};
			}),
		);
		expect(out.all).toHaveLength(2);
		expect(out.byRun[0]?.runId).toBe("run-2");
		expect(out.bySample[0]?.sampleId).toBe("s1");
	});

	it("paginates listings past a truncated page", async () => {
		const bucket = memBucket(1); // one object per page
		const out = await withStore(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				yield* store.putSample({ ...sample, id: "a" });
				yield* store.putSample({ ...sample, id: "b" });
				return yield* store.listSamples();
			}),
			bucket,
		);
		expect(out).toHaveLength(2);
	});

	it("fails typed on a corrupt stored sample", async () => {
		const bucket = memBucket();
		await bucket.put("samples/bad.json", '{"id":1}');
		await expect(
			withStore(
				Effect.gen(function* () {
					const store = yield* DatasetStorePort;
					return yield* store.getSample("bad");
				}),
				bucket,
			),
		).rejects.toThrow(/corrupt sample bad/);
	});

	it("rejects a real_anonymized sample missing provenance on write", async () => {
		const bad = { ...sample, provenance: undefined } as Sample;
		await expect(
			withStore(Effect.flatMap(DatasetStorePort, (s) => s.putSample(bad))),
		).rejects.toThrow(/invalid sample:[\s\S]*provenance/);
	});

	it("rejects a malformed result on write", async () => {
		const bad = { ...result, runId: 1 } as unknown as SampleResult;
		await expect(
			withStore(Effect.flatMap(DatasetStorePort, (s) => s.putResult(bad))),
		).rejects.toThrow(/invalid result/);
	});

	it("fails typed on a corrupt sample in a listing", async () => {
		const bucket = memBucket();
		await bucket.put("samples/bad.json", '{"id":1}');
		await expect(
			withStore(
				Effect.gen(function* () {
					const store = yield* DatasetStorePort;
					return yield* store.listSamples();
				}),
				bucket,
			),
		).rejects.toThrow(/corrupt sample/);
	});

	it("fails typed on a corrupt result in a listing", async () => {
		const bucket = memBucket();
		await bucket.put("results/run-1/x.json", '{"runId":1}');
		await expect(
			withStore(
				Effect.gen(function* () {
					const store = yield* DatasetStorePort;
					return yield* store.listResults();
				}),
				bucket,
			),
		).rejects.toThrow(/corrupt result/);
	});

	it("maps bucket failures to PortError on every path", async () => {
		const dead: BucketLike = {
			get: () => Promise.reject(new Error("r2 down")),
			put: () => Promise.reject(new Error("r2 down")),
			list: () => Promise.reject(new Error("r2 down")),
		};
		const run = (e: Effect.Effect<unknown, unknown, DatasetStorePort>) =>
			Effect.runPromise(e.pipe(Effect.provide(makeR2Store(dead))));
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.putSample(sample)))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.getSample("s1")))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.listSamples()))).rejects.toThrow(
			/r2 down/,
		);
		await expect(
			run(Effect.flatMap(DatasetStorePort, (s) => s.putBlob("u", new Uint8Array()))),
		).rejects.toThrow(/r2 down/);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.getBlob("u")))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.getBlobMeta("u")))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.putResult(result)))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.listResults()))).rejects.toThrow(
			/r2 down/,
		);
	});

	it("maps non-Error bucket rejections on every path", async () => {
		const dead: BucketLike = {
			get: () => Promise.reject("r2 down"),
			put: () => Promise.reject("r2 down"),
			list: () => Promise.reject("r2 down"),
		};
		const run = (e: Effect.Effect<unknown, unknown, DatasetStorePort>) =>
			Effect.runPromise(e.pipe(Effect.provide(makeR2Store(dead))));
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.putSample(sample)))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.getSample("s1")))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.listSamples()))).rejects.toThrow(
			/r2 down/,
		);
		await expect(
			run(Effect.flatMap(DatasetStorePort, (s) => s.putBlob("u", new Uint8Array()))),
		).rejects.toThrow(/r2 down/);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.getBlob("u")))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.getBlobMeta("u")))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.putResult(result)))).rejects.toThrow(
			/r2 down/,
		);
		await expect(run(Effect.flatMap(DatasetStorePort, (s) => s.listResults()))).rejects.toThrow(
			/r2 down/,
		);
	});
});

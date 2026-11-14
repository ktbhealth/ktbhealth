import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { afterAll, describe, expect, it } from "vitest";

import {
	DatasetStorePort,
	PortError,
	ReportPort,
	type RunRecord,
	type Sample,
} from "@ktb/eval-dataset";

import { makeLocalReportLayer, makeLocalStoreLayer } from "./index.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "eval-local-"));
const reportPath = path.join(root, "reports", "run.jsonl");

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const sample: Sample = {
	id: "s1",
	datasetVersion: "v1",
	origin: "synthetic",
	script: "script text",
	scriptHash: "h",
	persona: {
		region: "southeast",
		ageBand: "adult",
		register: "formal",
		specialty: "general_practice",
	},
	audio: { uri: "stub://audio/1" },
	gold: { validatedBy: "generator" },
};

const record: RunRecord = {
	runId: "run-1",
	taskId: "task-1",
	stage: "asr",
	engine: "test",
	model: "m1",
	inputHash: "h",
	latencyMs: 42,
	estCostUsd: 0.001,
	startedAt: 0,
};

describe("local store layer", () => {
	it("putSample/getSample/listSamples round-trip", async () => {
		const layer = makeLocalStoreLayer(root);
		const run = <A>(e: Effect.Effect<A, unknown, DatasetStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));

		await run(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				yield* store.putSample(sample);
			}),
		);

		const got = await run(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				return yield* store.getSample("s1");
			}),
		);
		expect(got).toEqual(sample);

		const listed = await run(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				return yield* store.listSamples({ origin: "synthetic" });
			}),
		);
		expect(listed.map((s) => s.id)).toEqual(["s1"]);

		const filteredOut = await run(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				return yield* store.listSamples({ origin: "real_anonymized" });
			}),
		);
		expect(filteredOut).toHaveLength(0);
	});

	it("blob put/get round-trip + missing → null", async () => {
		const layer = makeLocalStoreLayer(root);
		const bytes = new Uint8Array([1, 2, 3]);
		const run = <A>(e: Effect.Effect<A, unknown, DatasetStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));
		const r = await run(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				yield* store.putBlob("audio/x", bytes);
				return yield* store.getBlob("audio/x");
			}),
		);
		expect(r).toEqual(bytes);

		const missing = await run(
			Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				return yield* store.getBlob("nope");
			}),
		);
		expect(missing).toBeNull();
	});

	it("blob provenance round-trips; missing meta defaults to unknown", async () => {
		const layer = makeLocalStoreLayer(root);
		const run = <A>(e: Effect.Effect<A, unknown, DatasetStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));
		const r = await run(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				yield* s.putBlob("prov/syn", new Uint8Array([1]), { origin: "synthetic" });
				yield* s.putBlob("prov/real", new Uint8Array([2]), { origin: "real_anonymized" });
				yield* s.putBlob("prov/none", new Uint8Array([3]));
				return {
					syn: yield* s.getBlobMeta("prov/syn"),
					real: yield* s.getBlobMeta("prov/real"),
					none: yield* s.getBlobMeta("prov/none"),
					missing: yield* s.getBlobMeta("prov/missing"),
				};
			}),
		);
		expect(r.syn).toEqual({ origin: "synthetic" });
		expect(r.real).toEqual({ origin: "real_anonymized" });
		expect(r.none).toEqual({ origin: "unknown" });
		expect(r.missing).toBeNull();
	});

	it("putBlob rejects a bogus origin on write", async () => {
		const layer = makeLocalStoreLayer(root);
		const err = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putBlob("prov/bad", new Uint8Array([1]), {
						origin: "bogus" as never,
					});
				}).pipe(Effect.catchTag("PortError", (e) => Effect.succeed(e))),
				layer,
			),
		);
		expect(String(err)).toContain("putBlob");
	});

	it("getBlobMeta fails typed on a corrupt meta row", async () => {
		const layer = makeLocalStoreLayer(root);
		// Plant a corrupt provenance row directly — reads must surface
		// it as a PortError, never a silent null.
		const Database = (await import("better-sqlite3")).default;
		const db = new Database(path.join(root, "manifest.sqlite"));
		db.exec(`CREATE TABLE IF NOT EXISTS blob_meta (uri TEXT PRIMARY KEY, doc TEXT NOT NULL)`);
		db.prepare(`INSERT INTO blob_meta (uri, doc) VALUES (?, ?)`).run(
			"prov/corrupt",
			'{"origin":42}',
		);
		db.close();
		const err = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					return yield* s.getBlobMeta("prov/corrupt");
				}).pipe(Effect.catchTag("PortError", (e) => Effect.succeed(e))),
				layer,
			),
		);
		expect(err).toBeInstanceOf(PortError);
		expect((err as PortError).message).toContain("getBlobMeta");
	});

	it("putResult/listResults round-trip", async () => {
		const layer = makeLocalStoreLayer(root);
		const run = <A>(e: Effect.Effect<A, unknown, DatasetStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));
		const result = {
			runId: "r1",
			sampleId: "s1",
			datasetVersion: "v1",
			asrText: "raw",
			correctedText: "fixed",
			editVerdicts: [{ editIndex: 0, classification: "unjudged" as const }],
			confSegments: [{ confidence: 0.9, correct: true }],
			createdAt: 1,
		};
		const got = await run(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				yield* s.putResult(result);
				return yield* s.listResults({ sampleId: "s1" });
			}),
		);
		expect(got).toHaveLength(1);
		expect(got[0]?.asrText).toBe("raw");
		expect(got[0]?.editVerdicts[0]?.classification).toBe("unjudged");

		const byRun = await run(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				return yield* s.listResults({ runId: "other" });
			}),
		);
		expect(byRun).toHaveLength(0);
	});

	it("LGPD gate: real_anonymized without provenance is rejected", async () => {
		const layer = makeLocalStoreLayer(root);
		const err = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putSample({
						...sample,
						id: "bad-1",
						origin: "real_anonymized",
					});
				}).pipe(Effect.catchTag("PortError", (e) => Effect.succeed(e))),
				layer,
			),
		);
		expect(String(err)).toContain("provenance");
	});

	it("getBlob surfaces non-ENOENT fs errors instead of null", async () => {
		const layer = makeLocalStoreLayer(root);
		// Plant a directory where the blob file would live — readFileSync
		// then fails with EISDIR, which must NOT masquerade as "missing".
		const { createHash } = await import("node:crypto");
		const blobDir = path.join(root, "blobs", createHash("sha256").update("dir-uri").digest("hex"));
		fs.mkdirSync(blobDir, { recursive: true });
		const err = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					return yield* s.getBlob("dir-uri");
				}).pipe(Effect.catchTag("PortError", (e) => Effect.succeed(e))),
				layer,
			),
		);
		expect(String(err)).toContain("getBlob");
	});

	it("putResult rejects a malformed result on write", async () => {
		const layer = makeLocalStoreLayer(root);
		const err = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putResult({ runId: "r" } as never);
				}).pipe(Effect.catchTag("PortError", (e) => Effect.succeed(e))),
				layer,
			),
		);
		expect(String(err)).toContain("putResult");
	});
});

describe("local report layer", () => {
	it("append + render markdown", async () => {
		const layer = makeLocalReportLayer(reportPath);
		const md = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const report = yield* ReportPort;
					yield* report.append(record);
					yield* report.append({ ...record, runId: "other" });
					return yield* report.render("run-1");
				}),
				layer,
			),
		);
		expect(md).toContain("run-1");
		expect(md).toContain("| asr | test | m1 | 42 | 0.001 |");
		expect(md).not.toContain("| asr | test | m1 | 42 | 0.001 |\n| asr | test | m1 | 42 | 0.001 |");
	});

	it("render with no file → empty report", async () => {
		const layer = makeLocalReportLayer(path.join(root, "nope.jsonl"));
		const md = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const report = yield* ReportPort;
					return yield* report.render("none");
				}),
				layer,
			),
		);
		expect(md).toContain("no records");
	});
});

describe("branch coverage", () => {
	it("listSamples/listResults without filters return everything", async () => {
		const layer = makeLocalStoreLayer(root);
		const run = <A>(e: Effect.Effect<A, unknown, DatasetStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));
		const all = await run(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				return {
					samples: yield* s.listSamples(),
					results: yield* s.listResults(),
				};
			}),
		);
		expect(all.samples.length).toBeGreaterThan(0);
		expect(all.results.length).toBeGreaterThan(0);
	});

	it("render prints '-' for missing optional fields", async () => {
		const p = path.join(root, "reports", "sparse.jsonl");
		const layer = makeLocalReportLayer(p);
		const md = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const r = yield* ReportPort;
					yield* r.append({
						runId: "sparse-run",
						taskId: "t",
						stage: "s",
						engine: "e",
						inputHash: "h",
						startedAt: 0,
					});
					return yield* r.render("sparse-run");
				}),
				layer,
			),
		);
		expect(md).toContain("| - | s | e | - | - | - |");
	});
});

it("getSample returns null for unknown ids", async () => {
	await Effect.runPromise(
		Effect.scoped(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					expect(yield* s.getSample("nope")).toBeNull();
				}),
				makeLocalStoreLayer(root),
			),
		),
	);
});

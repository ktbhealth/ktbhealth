import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import Database from "better-sqlite3";
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
	ReportPort,
	renderRunMarkdown,
	type RunRecord,
} from "@ktb/eval-core";
import { DatasetStorePort, Sample, SampleResult } from "@ktb/eval-consultation";

/**
 * Local adapters — filesystem + SQLite, no network. Blobs land under
 * `<root>/blobs/<sha256-of-uri>` (hashed: URIs can exceed filename
 * limits), the manifest in `<root>/manifest.sqlite`, reports as
 * `<path>.jsonl` + rendered markdown.
 *
 * Side effects: fs mkdir/write/rename + SQLite file — all confined to
 * `rootDir` / the report file's directory. No network, no PHI path:
 * keep `origin="real_anonymized"` data out of this adapter (phase-2
 * gate is the Schema filter on Sample). `putBlob` meta lands in the
 * `blob_meta` table BEFORE the bytes so every stored blob carries
 * provenance for egress adapters (`unknown` when undeclared).
 */

const decodeSample = Schema.decodeUnknownSync(Sample);
const decodeResult = Schema.decodeUnknownSync(SampleResult);
const decodeBlobMeta = Schema.decodeUnknownSync(BlobMeta);
const decodeExperiment = Schema.decodeUnknownSync(Experiment);
const decodeDatasetManifest = Schema.decodeUnknownSync(DatasetManifest);
const decodeCalibration = Schema.decodeUnknownSync(CalibrationReport);

/** Hash the URI — opaque, fixed-length, traversal-proof filenames. */
const blobPath = (root: string, uri: string): string =>
	path.join(root, "blobs", createHash("sha256").update(uri).digest("hex"));

const fail = (port: string, op: string) => (cause: unknown) =>
	new PortError({
		port,
		message: `${op}: ${cause instanceof Error ? cause.message : /* v8 ignore next -- sqlite/fs throw Errors */ String(cause)}`,
		cause,
	});

/** Atomic write: tmp + rename so a crash never leaves a half file. */
const writeAtomic = (p: string, bytes: Uint8Array): void => {
	const tmp = `${p}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, bytes);
	fs.renameSync(tmp, p);
};

/** DatasetStorePort over SQLite (manifest + results) + filesystem
 * (blobs). The connection is scoped — the layer closes it on release. */
export const makeLocalStoreLayer = (rootDir: string) =>
	Layer.effect(
		DatasetStorePort,
		Effect.gen(function* () {
			yield* Effect.try({
				try: () => {
					fs.mkdirSync(path.join(rootDir, "blobs"), { recursive: true });
				},
				catch: fail("store-local", "mkdir"),
			});
			const db = yield* Effect.acquireRelease(
				Effect.try({
					try: () => {
						const d = new Database(path.join(rootDir, "manifest.sqlite"));
						d.pragma("journal_mode = WAL");
						d.pragma("busy_timeout = 5000");
						return d;
					},
					catch: fail("store-local", "open"),
				}),
				(db) => Effect.sync(() => db.close()),
			);
			yield* Effect.try({
				try: () =>
					db.exec(
						`CREATE TABLE IF NOT EXISTS samples (
							id TEXT PRIMARY KEY,
							dataset_version TEXT NOT NULL,
							origin TEXT NOT NULL,
							doc TEXT NOT NULL
						);
						CREATE TABLE IF NOT EXISTS results (
							run_id TEXT NOT NULL,
							sample_id TEXT NOT NULL,
							doc TEXT NOT NULL,
							PRIMARY KEY (run_id, sample_id)
						);
						CREATE TABLE IF NOT EXISTS blob_meta (
							uri TEXT PRIMARY KEY,
							doc TEXT NOT NULL
						)`,
					),
				catch: fail("store-local", "schema"),
			});
			const upsert = db.prepare(
				`INSERT INTO samples (id, dataset_version, origin, doc)
				 VALUES (@id, @dataset_version, @origin, @doc)
				 ON CONFLICT(id) DO UPDATE SET
					dataset_version = @dataset_version, origin = @origin,
					doc = @doc`,
			);
			const upsertResult = db.prepare(
				`INSERT INTO results (run_id, sample_id, doc)
				 VALUES (@run_id, @sample_id, @doc)
				 ON CONFLICT(run_id, sample_id) DO UPDATE SET doc = @doc`,
			);
			const select = db.prepare(`SELECT doc FROM samples WHERE id = ?`);
			const list = db.prepare(
				`SELECT doc FROM samples
				 WHERE (@origin IS NULL OR origin = @origin)
				 AND (@dataset_version IS NULL OR dataset_version = @dataset_version)`,
			);
			const selectBlobMeta = db.prepare(`SELECT doc FROM blob_meta WHERE uri = ?`);
			const upsertBlobMeta = db.prepare(
				`INSERT INTO blob_meta (uri, doc) VALUES (@uri, @doc)
				 ON CONFLICT(uri) DO UPDATE SET doc = @doc`,
			);
			const listRes = db.prepare(
				`SELECT doc FROM results
				 WHERE (@sample_id IS NULL OR sample_id = @sample_id)
				 AND (@run_id IS NULL OR run_id = @run_id)`,
			);

			return DatasetStorePort.of({
				putSample: (sample) =>
					Effect.try({
						try: () => {
							// Re-decode on write: the provenance filter fires here
							// too, not only on read — the LGPD gate holds even for
							// callers that bypass the type system.
							const validated = decodeSample(sample);
							upsert.run({
								id: validated.id,
								dataset_version: validated.datasetVersion,
								origin: validated.origin,
								doc: JSON.stringify(validated),
							});
						},
						catch: fail("store-local", "putSample"),
					}),
				getSample: (id) =>
					Effect.try({
						try: () => {
							const row = select.get(id) as { doc: string } | undefined;
							return row ? decodeSample(JSON.parse(row.doc)) : null;
						},
						catch: fail("store-local", "getSample"),
					}),
				listSamples: (filter) =>
					Effect.try({
						try: () =>
							(
								list.all({
									origin: filter?.origin ?? null,
									dataset_version: filter?.datasetVersion ?? null,
								}) as { doc: string }[]
							).map((r) => decodeSample(JSON.parse(r.doc))),
						catch: fail("store-local", "listSamples"),
					}),
				putBlob: (uri, bytes, meta) =>
					Effect.try({
						try: () => {
							// Re-decode on write, same as putSample: a bogus
							// origin fails here, not silently at read. Meta
							// lands BEFORE the bytes so every stored blob
							// has a provenance record — a failed write
							// leaves a conservative orphan meta, never an
							// unmarked blob.
							const validated = decodeBlobMeta({ origin: meta?.origin ?? "unknown" });
							upsertBlobMeta.run({ uri, doc: JSON.stringify(validated) });
							writeAtomic(blobPath(rootDir, uri), bytes);
						},
						catch: fail("store-local", "putBlob"),
					}),
				putBlobMeta: (uri, meta) =>
					Effect.try({
						try: () => {
							// Same write-side decode as putBlob — meta-only
							// registration for blobs produced outside the
							// store (file:// TTS output).
							const validated = decodeBlobMeta({ origin: meta?.origin ?? "unknown" });
							upsertBlobMeta.run({ uri, doc: JSON.stringify(validated) });
						},
						catch: fail("store-local", "putBlobMeta"),
					}),
				getBlobMeta: (uri) =>
					Effect.try({
						try: () => {
							const row = selectBlobMeta.get(uri) as { doc: string } | undefined;
							// null = no provenance record (pre-tracking blob
							// or URI never stored) — the documented bypass.
							return row ? decodeBlobMeta(JSON.parse(row.doc)) : null;
						},
						catch: fail("store-local", "getBlobMeta"),
					}),
				getBlob: (uri) =>
					Effect.try({
						try: () => {
							try {
								return new Uint8Array(fs.readFileSync(blobPath(rootDir, uri)));
							} catch (err) {
								// Only a missing blob is a legal null — EACCES,
								// EISDIR etc. are real failures, not "absent".
								if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
								throw err;
							}
						},
						catch: fail("store-local", "getBlob"),
					}),
				putResult: (result) =>
					Effect.try({
						try: () => {
							// Same write-side decode as putSample — a malformed
							// row fails here, not silently at listResults.
							const validated = decodeResult(result);
							upsertResult.run({
								run_id: validated.runId,
								sample_id: validated.sampleId,
								doc: JSON.stringify(validated),
							});
						},
						catch: fail("store-local", "putResult"),
					}),
				listResults: (filter) =>
					Effect.try({
						try: () =>
							(
								listRes.all({
									sample_id: filter?.sampleId ?? null,
									run_id: filter?.runId ?? null,
								}) as { doc: string }[]
							).map((r) => decodeResult(JSON.parse(r.doc))),
						catch: fail("store-local", "listResults"),
					}),
			});
		}),
	);

/** EvalStorePort over the SAME sqlite file as the dataset store —
 * separate connection + tables (experiments, dataset_manifests,
 * calibration_reports). Same doc-JSON pattern: schema decode on
 * write AND read, so a corrupt row fails loudly instead of silently
 * poisoning listings. WAL + busy_timeout tolerate the second
 * connection. */
export const makeLocalEvalStoreLayer = (rootDir: string) =>
	Layer.effect(
		EvalStorePort,
		Effect.gen(function* () {
			fs.mkdirSync(rootDir, { recursive: true });
			const db = yield* Effect.acquireRelease(
				Effect.try({
					try: () => {
						const d = new Database(path.join(rootDir, "manifest.sqlite"));
						d.pragma("journal_mode = WAL");
						d.pragma("busy_timeout = 5000");
						return d;
					},
					catch: fail("eval-store-local", "open"),
				}),
				(db) => Effect.sync(() => db.close()),
			);
			yield* Effect.try({
				try: () =>
					db.exec(
						`CREATE TABLE IF NOT EXISTS experiments (
							id TEXT PRIMARY KEY,
							doc TEXT NOT NULL
						);
						CREATE TABLE IF NOT EXISTS dataset_manifests (
							id TEXT NOT NULL,
							version TEXT NOT NULL,
							doc TEXT NOT NULL,
							PRIMARY KEY (id, version)
						);
						CREATE TABLE IF NOT EXISTS calibration_reports (
							id TEXT PRIMARY KEY,
							doc TEXT NOT NULL
						)`,
					),
				catch: fail("eval-store-local", "schema"),
			});
			const upsertExp = db.prepare(
				`INSERT INTO experiments (id, doc) VALUES (@id, @doc)
				 ON CONFLICT(id) DO UPDATE SET doc = @doc`,
			);
			const selectExp = db.prepare(`SELECT doc FROM experiments WHERE id = ?`);
			const listExp = db.prepare(`SELECT doc FROM experiments`);
			const upsertDs = db.prepare(
				`INSERT INTO dataset_manifests (id, version, doc)
				 VALUES (@id, @version, @doc)
				 ON CONFLICT(id, version) DO UPDATE SET doc = @doc`,
			);
			const selectDs = db.prepare(`SELECT doc FROM dataset_manifests WHERE id = ? AND version = ?`);
			const listDs = db.prepare(`SELECT doc FROM dataset_manifests`);
			const upsertCal = db.prepare(
				`INSERT INTO calibration_reports (id, doc) VALUES (@id, @doc)
				 ON CONFLICT(id) DO UPDATE SET doc = @doc`,
			);
			const listCal = db.prepare(`SELECT doc FROM calibration_reports`);

			return EvalStorePort.of({
				putExperiment: (experiment) =>
					Effect.try({
						try: () => {
							const validated = decodeExperiment(experiment);
							upsertExp.run({ id: validated.id, doc: JSON.stringify(validated) });
						},
						catch: fail("eval-store-local", "putExperiment"),
					}),
				getExperiment: (id) =>
					Effect.try({
						try: () => {
							const row = selectExp.get(id) as { doc: string } | undefined;
							return row ? decodeExperiment(JSON.parse(row.doc)) : null;
						},
						catch: fail("eval-store-local", "getExperiment"),
					}),
				listExperiments: (filter) =>
					Effect.try({
						try: () =>
							(listExp.all() as { doc: string }[])
								.map((r) => decodeExperiment(JSON.parse(r.doc)))
								.filter((e) => filter?.suiteId === undefined || e.suiteId === filter.suiteId),
						catch: fail("eval-store-local", "listExperiments"),
					}),
				putDatasetManifest: (manifest) =>
					Effect.try({
						try: () => {
							const validated = decodeDatasetManifest(manifest);
							const existing = selectDs.get(validated.id, validated.version) as
								| { doc: string }
								| undefined;
							if (existing !== undefined) {
								const prior = decodeDatasetManifest(JSON.parse(existing.doc));
								if (prior.contentHash !== validated.contentHash) {
									throw new Error(
										`dataset ${validated.id}@${validated.version} already registered ` +
											`with contentHash ${prior.contentHash} — refusing to overwrite ` +
											`with ${validated.contentHash}; bump the suite's dataset version`,
									);
								}
								return; // identical re-registration — idempotent
							}
							upsertDs.run({
								id: validated.id,
								version: validated.version,
								doc: JSON.stringify(validated),
							});
						},
						catch: fail("eval-store-local", "putDatasetManifest"),
					}),
				getDatasetManifest: (id, version) =>
					Effect.try({
						try: () => {
							const row = selectDs.get(id, version) as { doc: string } | undefined;
							return row ? decodeDatasetManifest(JSON.parse(row.doc)) : null;
						},
						catch: fail("eval-store-local", "getDatasetManifest"),
					}),
				listDatasetManifests: () =>
					Effect.try({
						try: () =>
							(listDs.all() as { doc: string }[]).map((r) =>
								decodeDatasetManifest(JSON.parse(r.doc)),
							),
						catch: fail("eval-store-local", "listDatasetManifests"),
					}),
				putCalibrationReport: (report) =>
					Effect.try({
						try: () => {
							const validated = decodeCalibration(report);
							upsertCal.run({ id: validated.id, doc: JSON.stringify(validated) });
						},
						catch: fail("eval-store-local", "putCalibrationReport"),
					}),
				listCalibrationReports: (filter) =>
					Effect.try({
						try: () =>
							(listCal.all() as { doc: string }[])
								.map((r) => decodeCalibration(JSON.parse(r.doc)))
								.filter(
									(c) =>
										(filter?.suiteId === undefined || c.suiteId === filter.suiteId) &&
										(filter?.runId === undefined || c.runId === filter.runId),
								),
						catch: fail("eval-store-local", "listCalibrationReports"),
					}),
			});
		}),
	);

/** ReportPort over `<path>.jsonl`; `render` emits a markdown table of
 * the run's records. */
export const makeLocalReportLayer = (filePath: string) =>
	Layer.succeed(
		ReportPort,
		ReportPort.of({
			append: (record: RunRecord) =>
				Effect.try({
					try: () => {
						fs.mkdirSync(path.dirname(filePath), { recursive: true });
						fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
					},
					catch: fail("report-local", "append"),
				}),
			render: (runId) =>
				Effect.try({
					try: () => {
						const records: RunRecord[] = fs.existsSync(filePath)
							? fs
									.readFileSync(filePath, "utf8")
									.split("\n")
									.filter((l) => l.trim())
									.map((l) => JSON.parse(l) as RunRecord)
							: [];
						return renderRunMarkdown(runId, records);
					},
					catch: fail("report-local", "render"),
				}),
		}),
	);
export * from "./tts.ts";
export * from "./asr.ts";
export * from "./llm.ts";
export * from "./eval.ts";
export * from "./systemone.ts";

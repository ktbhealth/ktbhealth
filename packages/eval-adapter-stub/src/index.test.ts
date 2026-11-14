import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { EvalPort, EvalStorePort, PortError, ReportPort } from "@ktb/eval-core";
import {
	AsrPort,
	DatasetStorePort,
	LlmPort,
	processSample,
	TtsPort,
	type Sample,
	type SampleResult,
} from "@ktb/eval-consultation";

import {
	CANNED_ASR,
	CANNED_EDITS,
	CANNED_RUN_RECORD,
	CANNED_SCRIPT,
	makeStubLayer,
	stubLive,
} from "./index.ts";

const sample: Sample = {
	id: "s1",
	datasetVersion: "v1",
	origin: "synthetic",
	script: CANNED_SCRIPT,
	scriptHash: "h",
	persona: {
		region: "southeast",
		ageBand: "adult",
		register: "formal",
		specialty: "general_practice",
	},
	audio: { uri: "stub://audio" },
	gold: { validatedBy: "generator" },
};

const run = <A>(e: Effect.Effect<A, unknown, unknown>) =>
	Effect.runPromise(Effect.provide(e as Effect.Effect<A, unknown, never>, stubLive));

describe("stubLive", () => {
	it("runs processSample end-to-end with canned values", async () => {
		const r = await run(
			processSample({
				sample,
				entities: [{ category: "medication", value: "cabeça" }],
			}),
		);
		expect(r.asr).toEqual(CANNED_ASR);
		expect(r.edits).toEqual(CANNED_EDITS);
		expect(r.corrected).toContain("cabeça");
		expect(r.editVerdicts[0]?.classification).toBe("justified_fix");
		expect(r.confSegments).toHaveLength(2);
	});
});

describe("makeStubLayer fixtures", () => {
	it("overrides canned outputs", async () => {
		const { layer } = makeStubLayer({
			asr: { text: "custom", segments: [], language: "pt" },
			edits: { ops: [] },
		});
		const r = await Effect.runPromise(
			Effect.provide(processSample({ sample, entities: [] }), layer),
		);
		expect(r.asr.text).toBe("custom");
	});
});

describe("fixture overrides", () => {
	it("audio + script + answers overrides flow through", async () => {
		const { layer } = makeStubLayer({
			audio: { uri: "stub://custom-audio", size: 9 },
			script: "script custom",
			edits: { ops: [] },
			answers: [],
		});
		const tts = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const t = yield* TtsPort;
					return yield* t.synthesize({
						script: "x",
						voiceId: "v",
						acoustic: { ttsModel: "m", voiceId: "v", noise: "clean", sampleRate: 16000 },
					});
				}),
				layer,
			),
		);
		expect(tts.audio.uri).toBe("stub://custom-audio");
		expect(tts.record.stage).toBe("tts");

		const gen = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const l = yield* LlmPort;
					return yield* l.generate({
						taskId: "t",
						role: "generator",
						input: "x",
						outputSchema: "S",
					});
				}),
				layer,
			),
		);
		expect(gen.text).toBe("script custom");

		const j = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const e = yield* EvalPort;
					return yield* e.judge({ state: {}, questions: [] });
				}),
				layer,
			),
		);
		expect(j.answers).toHaveLength(0);
		expect(j.record.stage).toBe("eval");
	});

	it("choice answer defaults to first option; score to 0", async () => {
		const { layer } = makeStubLayer({});
		const j = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const e = yield* EvalPort;
					return yield* e.judge({
						state: {},
						questions: [
							{ id: "q1", kind: "choice", text: "pick", options: ["optA", "optB"] },
							{ id: "q2", kind: "score", text: "rate", maxScore: 5 },
						],
					});
				}),
				layer,
			),
		);
		expect(j.answers[0]?.value).toBe("optA");
		expect(j.answers[1]?.value).toBe(0);
	});
});

describe("stub store + report ports", () => {
	it("samples, blobs and results round-trip through the maps", async () => {
		const { layer } = makeStubLayer();
		const run = <A>(e: Effect.Effect<A, unknown, DatasetStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));

		const r = await run(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				yield* s.putSample(sample);
				yield* s.putBlob("u1", new Uint8Array([7]), { origin: "synthetic" });
				yield* s.putBlob("u2", new Uint8Array([8]));
				yield* s.putResult({
					runId: "r1",
					sampleId: sample.id,
					asrText: "x",
					editVerdicts: [],
					confSegments: [],
					createdAt: 0,
				});
				return {
					one: yield* s.getSample(sample.id),
					miss: yield* s.getSample("nope"),
					list: yield* s.listSamples({ origin: "synthetic" }),
					none: yield* s.listSamples({ origin: "real_anonymized" }),
					blob: yield* s.getBlob("u1"),
					noBlob: yield* s.getBlob("zz"),
					meta: yield* s.getBlobMeta("u1"),
					metaDefault: yield* s.getBlobMeta("u2"),
					noMeta: yield* s.getBlobMeta("zz"),
					results: yield* s.listResults({ sampleId: sample.id }),
					noResults: yield* s.listResults({ runId: "other" }),
					all: yield* s.listSamples(),
				};
			}),
		);
		expect(r.one?.id).toBe(sample.id);
		expect(r.miss).toBeNull();
		expect(r.list).toHaveLength(1);
		expect(r.none).toHaveLength(0);
		expect(r.blob).toEqual(new Uint8Array([7]));
		expect(r.noBlob).toBeNull();
		expect(r.meta).toEqual({ origin: "synthetic" });
		// No declared origin records "unknown" — never silently synthetic.
		expect(r.metaDefault).toEqual({ origin: "unknown" });
		expect(r.noMeta).toBeNull();
		expect(r.results).toHaveLength(1);
		expect(r.noResults).toHaveLength(0);
		expect(r.all).toHaveLength(1);
	});

	it("putBlobMeta records provenance without bytes (M1)", async () => {
		const { layer } = makeStubLayer();
		const r = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putBlobMeta("file:///tmp/a.wav", { origin: "synthetic" });
					yield* s.putBlobMeta("file:///tmp/b.wav");
					return {
						meta: yield* s.getBlobMeta("file:///tmp/a.wav"),
						def: yield* s.getBlobMeta("file:///tmp/b.wav"),
						// Meta-only: no blob bytes were written.
						blob: yield* s.getBlob("file:///tmp/a.wav"),
					};
				}),
				layer,
			),
		);
		expect(r.meta).toEqual({ origin: "synthetic" });
		expect(r.def).toEqual({ origin: "unknown" });
		expect(r.blob).toBeNull();
	});

	it("write-side schema decode rejects what prod rejects (M8)", async () => {
		const { layer } = makeStubLayer();
		const run = <A, E>(e: Effect.Effect<A, E, DatasetStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));

		// real_anonymized without provenance — the LGPD filter fires
		// on write, same as eval-adapter-local.
		const badSample = { ...sample, origin: "real_anonymized" } as Sample;
		const sampleErr = await run(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				return yield* Effect.flip(s.putSample(badSample));
			}),
		);
		expect(sampleErr).toBeInstanceOf(PortError);
		expect(sampleErr.message).toContain("putSample");

		// Malformed result row.
		const resultErr = await run(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				return yield* Effect.flip(s.putResult({ runId: "r" } as SampleResult));
			}),
		);
		expect(resultErr).toBeInstanceOf(PortError);
		expect(resultErr.message).toContain("putResult");

		// Bogus blob origin.
		const metaErr = await run(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				return yield* Effect.flip(
					s.putBlobMeta("u", { origin: "bogus" } as unknown as { origin: "synthetic" }),
				);
			}),
		);
		expect(metaErr).toBeInstanceOf(PortError);
		expect(metaErr.message).toContain("putBlobMeta");
	});

	it("declares egress:false on every port — zero I/O", async () => {
		const { layer } = makeStubLayer();
		const flags = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					return {
						tts: (yield* TtsPort).egress,
						asr: (yield* AsrPort).egress,
						llm: (yield* LlmPort).egress,
						eval: (yield* EvalPort).egress,
					};
				}),
				layer,
			),
		);
		expect(flags).toEqual({ tts: false, asr: false, llm: false, eval: false });
	});

	it("render filters by runId", async () => {
		const { layer, records } = makeStubLayer();
		const md = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const rep = yield* ReportPort;
					yield* rep.append({ ...CANNED_RUN_RECORD, runId: "keep" });
					yield* rep.append({ ...CANNED_RUN_RECORD, runId: "drop" });
					return yield* rep.render("keep");
				}),
				layer,
			),
		);
		// Markdown table — same shape as the local adapter's render.
		expect(md).toContain("# run keep");
		expect(md).toContain("| - | stub | stub | - | 0 | - |");
		expect(md).not.toContain("# run drop");
		expect(records).toHaveLength(2);
	});
});

describe("default paths", () => {
	it("canned audio + script + choice-without-options", async () => {
		const { layer } = makeStubLayer();
		const tts = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const t = yield* TtsPort;
					return yield* t.synthesize({
						script: "x",
						voiceId: "v2",
						acoustic: { ttsModel: "m", voiceId: "v2", noise: "clean", sampleRate: 8000 },
					});
				}),
				layer,
			),
		);
		expect(tts.audio.uri).toBe("stub://tts/v2");

		const gen = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const l = yield* LlmPort;
					return yield* l.generate({
						taskId: "t",
						role: "generator",
						input: "x",
						outputSchema: "S",
					});
				}),
				layer,
			),
		);
		expect(gen.text).toBe(CANNED_SCRIPT);

		const j = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const e = yield* EvalPort;
					return yield* e.judge({
						state: {},
						questions: [{ id: "q", kind: "choice", text: "no opts" }],
					});
				}),
				layer,
			),
		);
		expect(j.answers[0]?.value).toBe("");
	});
});

it("listSamples filters by datasetVersion and non-matching origin", async () => {
	const { layer } = makeStubLayer();
	const rows = await Effect.runPromise(
		Effect.provide(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				yield* s.putSample(sample);
				const byVersion = yield* s.listSamples({ datasetVersion: "v1" });
				const byOther = yield* s.listSamples({ origin: "real_anonymized" });
				return [byVersion.length, byOther.length];
			}),
			layer,
		),
	);
	expect(rows).toEqual([1, 0]);
});

describe("stub eval store (P-076)", () => {
	const experiment = {
		id: "run-1",
		kind: "run" as const,
		suiteId: "s1",
		manifestHash: "h",
		profile: "stub",
		dataset: { id: "d", version: "v1" },
		startedAt: 1,
		summary: { ok: 2 },
	};
	const datasetManifest = {
		id: "d",
		version: "v1",
		domain: "dom",
		generator: { seed: 7 },
		createdAt: 1,
		sampleCount: 2,
		contentHash: "hash-a",
	};
	const calibration = {
		id: "cal-1",
		suiteId: "s1",
		dataset: { id: "d", version: "v1" },
		runId: "run-1",
		createdAt: 1,
		samples: 1,
		questions: 4,
		agreements: 3,
		agreementRate: 0.75,
		lowerBound: 0.3,
		kinds: [],
		buckets: [],
		judges: [],
	};

	it("experiments, manifests and calibrations round-trip with filters", async () => {
		const { layer } = makeStubLayer();
		const r = await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* EvalStorePort;
					yield* s.putExperiment(experiment);
					yield* s.putExperiment({ ...experiment, id: "run-2", suiteId: "s2" });
					yield* s.putDatasetManifest(datasetManifest);
					yield* s.putCalibrationReport(calibration);
					yield* s.putCalibrationReport({
						...calibration,
						id: "cal-2",
						suiteId: "s2",
						runId: "run-2",
					});
					return {
						exp: yield* s.getExperiment("run-1"),
						miss: yield* s.getExperiment("nope"),
						allExps: yield* s.listExperiments(),
						filtered: yield* s.listExperiments({ suiteId: "s2" }),
						ds: yield* s.getDatasetManifest("d", "v1"),
						dsMiss: yield* s.getDatasetManifest("d", "vX"),
						dsList: yield* s.listDatasetManifests(),
						cals: yield* s.listCalibrationReports(),
						calFiltered: yield* s.listCalibrationReports({ runId: "run-1" }),
						calNone: yield* s.listCalibrationReports({ suiteId: "ghost" }),
					};
				}),
				layer,
			),
		);
		expect(r.exp?.id).toBe("run-1");
		expect(r.miss).toBeNull();
		expect(r.allExps).toHaveLength(2);
		expect(r.filtered.map((e) => e.id)).toEqual(["run-2"]);
		expect(r.ds?.contentHash).toBe("hash-a");
		expect(r.dsMiss).toBeNull();
		expect(r.dsList).toHaveLength(1);
		expect(r.cals).toHaveLength(2);
		expect(r.calFiltered.map((c) => c.id)).toEqual(["cal-1"]);
		expect(r.calNone).toEqual([]);
	});

	it("dataset registry: idempotent same-hash, conflict on diff hash", async () => {
		const { layer } = makeStubLayer();
		const run = <A, E>(e: Effect.Effect<A, E, EvalStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));
		await run(
			Effect.gen(function* () {
				const s = yield* EvalStorePort;
				yield* s.putDatasetManifest(datasetManifest);
				yield* s.putDatasetManifest({ ...datasetManifest, createdAt: 2 });
				const err = yield* Effect.flip(
					s.putDatasetManifest({ ...datasetManifest, contentHash: "hash-b" }),
				);
				expect(err).toBeInstanceOf(PortError);
				expect((err as PortError).message).toContain("already registered");
			}),
		);
	});

	it("write-side schema decode rejects malformed artifacts", async () => {
		const { layer } = makeStubLayer();
		const run = <A, E>(e: Effect.Effect<A, E, EvalStorePort>) =>
			Effect.runPromise(Effect.provide(e, layer));
		const expErr = await run(
			Effect.gen(function* () {
				const s = yield* EvalStorePort;
				return yield* Effect.flip(s.putExperiment({ id: "bad" } as never));
			}),
		);
		expect(expErr).toBeInstanceOf(PortError);
		expect((expErr as PortError).message).toContain("putExperiment");
		const dsErr = await run(
			Effect.gen(function* () {
				const s = yield* EvalStorePort;
				return yield* Effect.flip(s.putDatasetManifest({ id: "x" } as never));
			}),
		);
		expect(dsErr).toBeInstanceOf(PortError);
		expect((dsErr as PortError).message).toContain("putDatasetManifest");
		const calErr = await run(
			Effect.gen(function* () {
				const s = yield* EvalStorePort;
				return yield* Effect.flip(s.putCalibrationReport({ id: "bad" } as never));
			}),
		);
		expect(calErr).toBeInstanceOf(PortError);
		expect((calErr as PortError).message).toContain("putCalibrationReport");
	});
});

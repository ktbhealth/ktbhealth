import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
	DatasetStorePort,
	EvalPort,
	LlmPort,
	ReportPort,
	TtsPort,
	processSample,
	type Sample,
} from "@ktb/eval-dataset";

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
	persona: { region: "se", ageBand: "adulto", register: "formal", specialty: "clinico" },
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
				yield* s.putBlob("u1", new Uint8Array([7]));
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
		expect(r.results).toHaveLength(1);
		expect(r.noResults).toHaveLength(0);
		expect(r.all).toHaveLength(1);
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
		expect(md).toContain('"runId":"keep"');
		expect(md).not.toContain('"runId":"drop"');
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

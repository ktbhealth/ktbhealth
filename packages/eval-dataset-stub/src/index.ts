import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
	AsrPort,
	DatasetStorePort,
	EvalPort,
	LlmPort,
	ReportPort,
	renderRunMarkdown,
	TtsPort,
	type AsrResult,
	type AudioRef,
	type EditList,
	type EvalAnswer,
	type RunRecord,
	type Sample,
	type SampleResult,
} from "@ktb/eval-dataset";

/**
 * Deterministic stub adapters — zero I/O, zero cost. The fast CI path
 * and unit tests run entirely on these; live adapters must match the
 * same output *shapes*.
 *
 * Each port has its own maker so callers can mix real and stub
 * adapters (e.g. live ASR + stub judge). `makeStubLayer` composes
 * them all with shared state handles for tests.
 */

export const CANNED_AUDIO_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"

export const CANNED_SCRIPT =
	"Doctor: o que você está sentindo? Patient: dor de cabeça forte há três dias.";

export const CANNED_ASR: AsrResult = {
	text: "o que você está sentindo dor de cabeca forte ha tres dias",
	language: "pt",
	segments: [
		{ t0: 0, t1: 2.5, text: "o que você está sentindo", confidence: 0.92 },
		{ t0: 2.5, t1: 6, text: "dor de cabeca forte ha tres dias", confidence: 0.78 },
	],
};

/** One known correction: "cabeca" → "cabeça" (entity-kind, flagged —
 * touches a clinical word). */
export const CANNED_EDITS: EditList = {
	ops: [
		{
			at: 32,
			remove: "cabeca",
			insert: "cabeça",
			kind: "entity",
			flagged: true,
		},
	],
};

export const CANNED_RUN_RECORD: RunRecord = {
	runId: "stub-run",
	taskId: "stub-task",
	stage: "stub",
	engine: "stub",
	inputHash: "stubhash",
	latencyMs: 0,
	startedAt: 0,
};

export interface StubFixtures {
	readonly audio?: AudioRef;
	readonly asr?: AsrResult;
	readonly script?: string;
	readonly edits?: EditList;
	readonly answers?: readonly EvalAnswer[];
}

const record = (stage: string, taskId: string): RunRecord => ({
	...CANNED_RUN_RECORD,
	stage,
	taskId,
});

const answerOf = (q: { id: string; kind: string; options?: readonly string[] }): EvalAnswer => ({
	id: q.id,
	kind: q.kind as EvalAnswer["kind"],
	value: q.kind === "noul" ? true : q.kind === "choice" ? (q.options?.[0] ?? "") : 0,
	probability: 0.95,
});

export const makeStubTts = (fixtures: StubFixtures = {}) =>
	Layer.succeed(
		TtsPort,
		TtsPort.of({
			synthesize: (input) =>
				Effect.succeed({
					audio: fixtures.audio ?? {
						uri: `stub://tts/${input.voiceId}`,
						size: CANNED_AUDIO_BYTES.length,
						contentType: "audio/wav",
					},
					record: record("tts", `stub-tts-${input.voiceId}`),
				}),
		}),
	);

export const makeStubAsr = (fixtures: StubFixtures = {}) =>
	Layer.succeed(
		AsrPort,
		AsrPort.of({
			transcribe: () =>
				Effect.succeed({ asr: fixtures.asr ?? CANNED_ASR, record: record("asr", "stub-asr") }),
		}),
	);

export const makeStubLlm = (fixtures: StubFixtures = {}) =>
	Layer.succeed(
		LlmPort,
		LlmPort.of({
			generate: (envelope) =>
				Effect.succeed({
					text: fixtures.script ?? CANNED_SCRIPT,
					record: record("script_gen", envelope.taskId),
				}),
			correct: (envelope) =>
				Effect.succeed({
					edits: fixtures.edits ?? CANNED_EDITS,
					record: record("cleanup", envelope.taskId),
				}),
		}),
	);

export const makeStubEval = (fixtures: StubFixtures = {}) =>
	Layer.succeed(
		EvalPort,
		EvalPort.of({
			judge: (input) =>
				Effect.succeed({
					answers: fixtures.answers ?? input.questions.map(answerOf),
					record: record("eval", "stub-judge"),
				}),
		}),
	);

/** Shared mutable state behind the stub store — pass your own maps to
 * inspect what the adapter persisted. */
export interface StubStoreState {
	readonly samples: Map<string, Sample>;
	readonly blobs: Map<string, Uint8Array>;
	readonly results: Map<string, SampleResult>;
}

export const makeStubStore = (state: Partial<StubStoreState> = {}) => {
	const samples = state.samples ?? new Map<string, Sample>();
	const blobs = state.blobs ?? new Map<string, Uint8Array>();
	const results = state.results ?? new Map<string, SampleResult>();
	return Layer.succeed(
		DatasetStorePort,
		DatasetStorePort.of({
			putSample: (sample) => Effect.sync(() => void samples.set(sample.id, sample)),
			getSample: (id) => Effect.succeed(samples.get(id) ?? null),
			listSamples: (filter) =>
				Effect.succeed(
					[...samples.values()].filter(
						(s) =>
							(filter?.origin === undefined || s.origin === filter.origin) &&
							(filter?.datasetVersion === undefined || s.datasetVersion === filter.datasetVersion),
					),
				),
			putBlob: (uri, bytes) => Effect.sync(() => void blobs.set(uri, bytes)),
			getBlob: (uri) => Effect.succeed(blobs.get(uri) ?? null),
			putResult: (result) =>
				Effect.sync(() => void results.set(`${result.runId}/${result.sampleId}`, result)),
			listResults: (filter) =>
				Effect.succeed(
					[...results.values()].filter(
						(r) =>
							(filter?.sampleId === undefined || r.sampleId === filter.sampleId) &&
							(filter?.runId === undefined || r.runId === filter.runId),
					),
				),
		}),
	);
};

export const makeStubReport = (records: RunRecord[] = []) =>
	Layer.succeed(
		ReportPort,
		ReportPort.of({
			append: (r) => Effect.sync(() => void records.push(r)),
			// Same markdown shape as the local adapter — render format is
			// part of the port contract, not adapter-defined.
			render: (runId) => Effect.succeed(renderRunMarkdown(runId, records)),
		}),
	);

/** Build one merged layer with every stub port; fixtures override the
 * canned outputs for tests that need specific data. */
export const makeStubLayer = (fixtures: StubFixtures = {}) => {
	const samples = new Map<string, Sample>();
	const blobs = new Map<string, Uint8Array>();
	const results = new Map<string, SampleResult>();
	const records: RunRecord[] = [];

	return {
		layer: Layer.mergeAll(
			makeStubTts(fixtures),
			makeStubAsr(fixtures),
			makeStubLlm(fixtures),
			makeStubEval(fixtures),
			makeStubStore({ samples, blobs, results }),
			makeStubReport(records),
		),
		records,
		results,
	};
};

/** Default shared layer — canned everything. Stateless outputs, but
 * tests mutating its maps should call `makeStubLayer()` instead. */
export const stubLive = makeStubLayer().layer;

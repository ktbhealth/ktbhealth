import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Schema } from "effect";

import {
	BlobMeta,
	EvalPort,
	PortError,
	ReportPort,
	renderRunMarkdown,
	type EditList,
	type EvalAnswer,
	type RunRecord,
} from "@ktb/eval-core";
import {
	AsrPort,
	DatasetStorePort,
	LlmPort,
	Sample,
	SampleResult,
	TtsPort,
	type AsrResult,
	type AudioRef,
} from "@ktb/eval-consult";

/**
 * Deterministic stub adapters — zero I/O, zero cost. The fast CI path
 * and unit tests run entirely on these; live adapters must match the
 * same output *shapes*.
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

// Write-side schema decode — same contract as the real adapters
// (eval-adapter-local/cloud): the LGPD provenance filter and shape
// checks fire on putSample/putResult/putBlobMeta, so tests can never
// persist what production would reject (M8).
const decodeSample = Schema.decodeUnknownSync(Sample);
const decodeResult = Schema.decodeUnknownSync(SampleResult);
const decodeBlobMeta = Schema.decodeUnknownSync(BlobMeta);

const decode = <A>(schema: (u: unknown) => A, value: unknown, op: string) =>
	Effect.try({
		try: () => schema(value),
		catch: (cause) =>
			new PortError({
				port: "store-stub",
				message: `${op}: schema validation failed`,
				cause,
			}),
	});

/** Deterministic canned answer for one question — the single
 * implementation shared by this package's judge AND the CLI's stub
 * eval layer (apps/eval adapters.ts), so both produce identical
 * verdict shapes. */
export const stubAnswerOf = (q: {
	id: string;
	kind: string;
	options?: readonly string[];
}): EvalAnswer => ({
	id: q.id,
	kind: q.kind as EvalAnswer["kind"],
	value: q.kind === "noul" ? true : q.kind === "choice" ? (q.options?.[0] ?? "") : 0,
	probability: 0.95,
});

/** Build one merged layer with every stub port; fixtures override the
 * canned outputs for tests that need specific data. */
export const makeStubLayer = (fixtures: StubFixtures = {}) => {
	const samples = new Map<string, Sample>();
	const blobs = new Map<string, Uint8Array>();
	const blobMeta = new Map<string, BlobMeta>();
	const results = new Map<string, SampleResult>();
	const records: RunRecord[] = [];

	const tts = Layer.succeed(
		TtsPort,
		TtsPort.of({
			egress: false, // zero I/O — nothing leaves the process
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

	const asr = Layer.succeed(
		AsrPort,
		AsrPort.of({
			egress: false,
			transcribe: () =>
				Effect.succeed({ asr: fixtures.asr ?? CANNED_ASR, record: record("asr", "stub-asr") }),
		}),
	);

	const llm = Layer.succeed(
		LlmPort,
		LlmPort.of({
			egress: false,
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

	const evalPort = Layer.succeed(
		EvalPort,
		EvalPort.of({
			egress: false,
			judge: (input) =>
				Effect.succeed({
					answers: fixtures.answers ?? input.questions.map(stubAnswerOf),
					record: record("eval", "stub-judge"),
				}),
		}),
	);

	const store = Layer.succeed(
		DatasetStorePort,
		DatasetStorePort.of({
			putSample: (sample) =>
				decode(decodeSample, sample, "putSample").pipe(
					Effect.flatMap((validated) =>
						Effect.sync(() => void samples.set(validated.id, validated)),
					),
				),
			getSample: (id) => Effect.succeed(samples.get(id) ?? null),
			listSamples: (filter) =>
				Effect.succeed(
					[...samples.values()].filter(
						(s) =>
							(filter?.origin === undefined || s.origin === filter.origin) &&
							(filter?.datasetVersion === undefined || s.datasetVersion === filter.datasetVersion),
					),
				),
			putBlob: (uri, bytes, meta) =>
				decode(decodeBlobMeta, { origin: meta?.origin ?? "unknown" }, "putBlob").pipe(
					Effect.flatMap((validated) =>
						Effect.sync(() => {
							blobs.set(uri, bytes);
							// Same default as the real adapters: no declared
							// origin records "unknown", never silently synthetic.
							blobMeta.set(uri, validated);
						}),
					),
				),
			putBlobMeta: (uri, meta) =>
				decode(decodeBlobMeta, { origin: meta?.origin ?? "unknown" }, "putBlobMeta").pipe(
					Effect.flatMap((validated) => Effect.sync(() => void blobMeta.set(uri, validated))),
				),
			getBlob: (uri) => Effect.succeed(blobs.get(uri) ?? null),
			getBlobMeta: (uri) => Effect.succeed(blobMeta.get(uri) ?? null),
			putResult: (result) =>
				decode(decodeResult, result, "putResult").pipe(
					Effect.flatMap((validated) =>
						Effect.sync(
							() => void results.set(`${validated.runId}/${validated.sampleId}`, validated),
						),
					),
				),
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

	const report = Layer.succeed(
		ReportPort,
		ReportPort.of({
			append: (r) => Effect.sync(() => void records.push(r)),
			// Same markdown shape as the local adapter — render format is
			// part of the port contract, not adapter-defined.
			render: (runId) => Effect.succeed(renderRunMarkdown(runId, records)),
		}),
	);

	return { layer: Layer.mergeAll(tts, asr, llm, evalPort, store, report), records, results };
};

/** Default shared layer — canned everything. Stateless outputs, but
 * tests mutating its maps should call `makeStubLayer()` instead. */
export const stubLive = makeStubLayer().layer;

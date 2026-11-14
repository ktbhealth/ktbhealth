import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import {
	processSample,
	generateScript,
	synthesizeAudio,
	transcribeSample,
	cleanupTranscript,
	entityQuestions,
	cleanupQuestions,
	recordRun,
	saveSample,
} from "./pipeline.ts";
import {
	AsrPort,
	DatasetStorePort,
	EvalPort,
	LlmPort,
	ReportPort,
	TtsPort,
	PortError,
} from "./ports.ts";
import type { RunRecord, Sample } from "./schema.ts";

const record: RunRecord = {
	runId: "r1",
	taskId: "t1",
	stage: "s",
	engine: "test",
	inputHash: "h",
	startedAt: 0,
};

const asrResult = {
	text: "o paciente nega febre e toma losartana 50 mg",
	language: "pt",
	segments: [
		{ t0: 0, t1: 1, text: "o paciente nega febre", confidence: 0.9 },
		{ t0: 1, t1: 2, text: "e toma losartana 50 mg" },
	],
};

const sample: Sample = {
	id: "s1",
	datasetVersion: "v1",
	origin: "synthetic",
	script: "o paciente nega febre e toma losartana 50 mg",
	scriptHash: "h",
	persona: {
		region: "southeast",
		ageBand: "adult",
		register: "colloquial",
		specialty: "general_practice",
	},
	audio: { uri: "stub://a" },
	gold: { validatedBy: "generator" },
};

const entities = [
	{ category: "negation" as const, value: "nega febre" },
	{ category: "medication" as const, value: "losartana 50 mg" },
];

const appended: RunRecord[] = [];
const stored = new Map<string, Sample>();
const storedResults = new Map<string, unknown>();

const live = Layer.mergeAll(
	Layer.succeed(
		AsrPort,
		AsrPort.of({ transcribe: () => Effect.succeed({ asr: asrResult, record }) }),
	),
	Layer.succeed(
		LlmPort,
		LlmPort.of({
			generate: () => Effect.succeed({ text: "script", record }),
			correct: (env) =>
				Effect.succeed({
					edits: {
						ops: [
							{
								at: 0,
								remove: env.input[0] ?? "",
								insert: (env.input[0] ?? "").toUpperCase(),
								kind: "punct",
							},
						],
					},
					record,
				}),
		}),
	),
	Layer.succeed(
		EvalPort,
		EvalPort.of({
			judge: (input) =>
				Effect.succeed({
					answers: input.questions.map((q) => ({
						id: q.id,
						kind: q.kind,
						value: q.kind === "noul" ? true : "justified_fix",
						probability: 0.97,
					})),
					record,
				}),
		}),
	),
	Layer.succeed(
		DatasetStorePort,
		DatasetStorePort.of({
			putSample: (s) => Effect.sync(() => void stored.set(s.id, s)),
			getSample: (id) => Effect.succeed(stored.get(id) ?? null),
			listSamples: () => Effect.succeed([sample]),
			putBlob: () => Effect.void,
			getBlob: () => Effect.succeed(null),
			putResult: (r) => Effect.sync(() => void storedResults.set(r.sampleId, r)),
			listResults: () => Effect.succeed([]),
		}),
	),
	Layer.succeed(
		ReportPort,
		ReportPort.of({
			append: (r) => Effect.sync(() => void appended.push(r)),
			render: () => Effect.succeed("report"),
		}),
	),
	Layer.succeed(
		TtsPort,
		TtsPort.of({
			synthesize: () => Effect.succeed({ audio: { uri: "stub://tts", size: 4 }, record }),
		}),
	),
);

const run = <A>(e: Effect.Effect<A, unknown, unknown>) =>
	Effect.runPromise(Effect.provide(e as Effect.Effect<A, unknown, never>, live));

describe("generateScript / synthesizeAudio / cleanupTranscript", () => {
	it("delegates through ports", async () => {
		const g = await run(
			generateScript({
				taskId: "t",
				persona: sample.persona,
				seed: 42,
			}),
		);
		expect(g.text).toBe("script");

		const a = await run(
			synthesizeAudio({
				script: "x",
				acoustic: {
					ttsModel: "m",
					voiceId: "v",
					noise: "clean",
					sampleRate: 16000,
				},
			}),
		);
		expect(a.audio.uri).toBe("stub://tts");

		const c = await run(cleanupTranscript({ taskId: "t", raw: "raw" }));
		expect(c.corrected.startsWith("R")).toBe(true);
	});
});

describe("transcribeSample", () => {
	it("returns ASR output", async () => {
		const r = await run(transcribeSample(sample));
		expect(r.asr.text).toContain("losartana");
	});

	it("fails when the sample has no audio", async () => {
		const err = await run(
			transcribeSample({ ...sample, audio: undefined }).pipe(
				Effect.catchTag("PortError", (e: PortError) => Effect.succeed(e)),
			),
		);
		expect(err).toBeInstanceOf(PortError);
	});

	it("forwards the sample origin to the ASR port", async () => {
		let seen: unknown;
		const capture = Layer.succeed(
			AsrPort,
			AsrPort.of({
				transcribe: (_audio, opts) =>
					Effect.sync(() => {
						seen = opts;
						return { asr: asrResult, record };
					}),
			}),
		);
		await Effect.runPromise(Effect.provide(transcribeSample(sample), capture));
		expect(seen).toEqual({ language: "pt", origin: "synthetic" });
	});
});

describe("question builders", () => {
	it("entity questions are per-stage noul", () => {
		const qs = entityQuestions(entities, "corrected");
		expect(qs).toHaveLength(2);
		expect(qs[0]?.id).toBe("entity:corrected:negation:0");
		expect(qs[0]?.kind).toBe("noul");
	});

	it("cleanup questions are choice per edit", () => {
		const qs = cleanupQuestions({
			ops: [{ at: 0, remove: "a", insert: "b", kind: "fix" }],
		});
		expect(qs[0]?.kind).toBe("choice");
		expect(qs[0]?.options).toContain("harmful");
	});
});

describe("processSample", () => {
	it("runs S3→S4→S7 and reports per-stage metrics", async () => {
		const r = await run(processSample({ sample, entities }));
		expect(r.corrected.startsWith("O")).toBe(true);
		expect(r.asrMetrics.wer).toBe(0);
		expect(r.asrMetrics.criticalErrors).toBe(0);
		expect(r.editVerdicts[0]?.classification).toBe("justified_fix");
		expect(r.confSegments).toHaveLength(2);
	});

	it("skips judging when there is nothing to ask", async () => {
		const r = await run(processSample({ sample, entities: [] }));
		expect(r.asrMetrics.entityVerdicts).toHaveLength(0);
	});

	it("real_anonymized: fails closed when the PHI gate finds residuals", async () => {
		const real: Sample = {
			...sample,
			origin: "real_anonymized",
			// 14-digit run survives every scrub pattern → gate returns null.
			script: "registro interno 20240102030405 do paciente",
			provenance: {
				sourcePartner: "clinic-x",
				anonymizationMethod: "phi-scrub-v1",
				consentRef: "consent-1",
				lgpdBasis: "legitimate_interest",
			},
		};
		const err = await run(
			processSample({ sample: real, entities }).pipe(
				Effect.catchTag("PortError", (e: PortError) => Effect.succeed(e)),
			),
		);
		expect(err).toBeInstanceOf(PortError);
		expect(String((err as PortError).message)).toContain("PHI gate");
	});

	it("real_anonymized: scrubs the script before it reaches judge state", async () => {
		const seen: unknown[] = [];
		const captureJudge = Layer.succeed(
			EvalPort,
			EvalPort.of({
				judge: (input) =>
					Effect.sync(() => {
						seen.push(input.state);
						return {
							answers: input.questions.map((q) => ({
								id: q.id,
								kind: q.kind,
								value: q.kind === "noul" ? true : "justified_fix",
								probability: 0.9,
							})),
							record,
						};
					}),
			}),
		);
		const real: Sample = {
			...sample,
			origin: "real_anonymized",
			script: "paciente cpf 123.456.789-00 nega febre",
			provenance: {
				sourcePartner: "clinic-x",
				anonymizationMethod: "phi-scrub-v1",
				consentRef: "consent-1",
				lgpdBasis: "legitimate_interest",
			},
		};
		await Effect.runPromise(
			Effect.provide(processSample({ sample: real, entities }), Layer.merge(live, captureJudge)),
		);
		const dumped = JSON.stringify(seen);
		expect(dumped).toContain("[CPF]");
		expect(dumped).not.toContain("123.456.789-00");
	});
});

describe("recordRun / saveSample", () => {
	it("append and persist", async () => {
		await run(recordRun(record));
		await run(saveSample(sample));
		expect(appended).toContain(record);
		expect(stored.get(sample.id)).toEqual(sample);
	});
});

describe("failure modes", () => {
	it("corrupt edit list → typed PortError, not a defect", async () => {
		const badLlm = Layer.succeed(
			LlmPort,
			LlmPort.of({
				generate: () => Effect.succeed({ text: "x", record }),
				correct: () =>
					Effect.succeed({
						edits: { ops: [{ at: 5, remove: "nope", insert: "x", kind: "fix" }] },
						record,
					}),
			}),
		);
		const err = await Effect.runPromise(
			Effect.provide(
				cleanupTranscript({ taskId: "t", raw: "texto real" }).pipe(
					Effect.catchTag("PortError", (e) => Effect.succeed(e)),
				),
				badLlm,
			),
		);
		expect(err).toBeInstanceOf(PortError);
		expect(String((err as PortError).message)).toContain("corrupt edit list");
	});

	it("missing judge answer → unjudged, never silently benign", async () => {
		const emptyJudge = Layer.succeed(
			EvalPort,
			EvalPort.of({
				judge: () => Effect.succeed({ answers: [], record }),
			}),
		);
		const r = await Effect.runPromise(
			Effect.provide(processSample({ sample, entities }), Layer.merge(live, emptyJudge)),
		);
		expect(r.editVerdicts[0]?.classification).toBe("unjudged");
	});
});

describe("toSampleResult / saveResult / recordAll", () => {
	it("persists the full audit trail", async () => {
		const { toSampleResult, saveResult, recordAll } = await import("./pipeline.ts");
		const r = await run(processSample({ sample, entities, runId: "run-x" }));
		const result = toSampleResult({ sample, runId: "run-x", run: r });
		expect(result.sampleId).toBe("s1");
		expect(result.asrText).toContain("losartana");
		expect(result.edits?.ops).toHaveLength(1);

		await run(saveResult(result));
		expect(storedResults.get("s1")).toEqual(result);

		appended.length = 0;
		await run(recordAll(r.records));
		expect(appended.length).toBeGreaterThan(0);
		expect(appended.every((x) => x.runId === "run-x" && x.sampleId === "s1")).toBe(true);
	});

	it("entities default to gold.entities when not passed", async () => {
		const s2: Sample = { ...sample, gold: { validatedBy: "generator", entities } };
		const r = await run(processSample({ sample: s2 }));
		expect(r.asrMetrics.entityVerdicts).toHaveLength(2);
	});
});

describe("defaults", () => {
	it("generateScript without seed omits it from the envelope", async () => {
		const g = await run(generateScript({ taskId: "t2", persona: sample.persona }));
		expect(g.text).toBe("script");
	});

	it("processSample with no entities arg and no gold.entities judges nothing", async () => {
		const r = await run(processSample({ sample }));
		expect(r.asrMetrics.entityVerdicts).toHaveLength(0);
	});
});

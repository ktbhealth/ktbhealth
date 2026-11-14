import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { runBatch } from "@ktb/eval-core";

import { processSample } from "./pipeline.ts";
import { AsrPort, DatasetStorePort, EvalPort, LlmPort, PortError, ReportPort } from "./ports.ts";
import type { Sample } from "./schema.ts";

const sample = (id: string): Sample => ({
	id,
	datasetVersion: "v1",
	origin: "synthetic",
	script: "o paciente nega febre e toma losartana 50 mg",
	scriptHash: `h-${id}`,
	persona: {
		region: "southeast",
		ageBand: "adult",
		register: "colloquial",
		specialty: "general_practice",
	},
	audio: { uri: `stub://a-${id}` },
	gold: { validatedBy: "generator" },
});

describe("runBatch e2e — processSample over stub ports", () => {
	const canned = (raw: string) => ({
		asr: { text: raw, language: "pt", segments: [{ t0: 0, t1: 1, text: raw, confidence: 0.9 }] },
	});

	const makeLayer = (failOnId?: string) => {
		const asr = AsrPort.of({
			transcribe: (audio) =>
				audio.uri.includes(failOnId ?? "\u0000")
					? Effect.fail(new PortError({ port: "asr", message: "engine down" }))
					: Effect.succeed({
							asr: canned("o paciente nega febre e toma losartana 50 mg").asr,
							record: {
								runId: "r",
								taskId: audio.uri,
								stage: "asr",
								engine: "stub",
								inputHash: "h",
								startedAt: 0,
							},
						}),
		});
		const llm = LlmPort.of({
			generate: () => Effect.die("not used"),
			correct: () =>
				Effect.succeed({
					edits: { ops: [] },
					record: {
						runId: "r",
						taskId: "t",
						stage: "cleanup",
						engine: "stub",
						inputHash: "h",
						startedAt: 0,
					},
				}),
		});
		const evalP = EvalPort.of({
			judge: () =>
				Effect.succeed({
					answers: [],
					record: {
						runId: "r",
						taskId: "t",
						stage: "eval",
						engine: "stub",
						inputHash: "h",
						startedAt: 0,
					},
				}),
		});
		const store = DatasetStorePort.of({
			putSample: () => Effect.void,
			getSample: () => Effect.succeed(null),
			listSamples: () => Effect.succeed([]),
			putBlob: () => Effect.void,
			getBlob: () => Effect.succeed(null),
			getBlobMeta: () => Effect.succeed(null),
			putResult: () => Effect.void,
			listResults: () => Effect.succeed([]),
		});
		const report = ReportPort.of({
			append: () => Effect.void,
			render: () => Effect.succeed(""),
		});
		return Layer.mergeAll(
			Layer.succeed(AsrPort, asr),
			Layer.succeed(LlmPort, llm),
			Layer.succeed(EvalPort, evalP),
			Layer.succeed(DatasetStorePort, store),
			Layer.succeed(ReportPort, report),
		);
	};

	it("processes a batch end-to-end and isolates the engine-down sample", async () => {
		const samples = [sample("s1"), sample("s2"), sample("s3")];
		const r = await Effect.runPromise(
			Effect.provide(
				runBatch({
					items: samples,
					step: (s) => processSample({ sample: s }),
					options: { concurrency: 2, retry: Schedule.recurs(1) },
				}),
				makeLayer("s2"),
			),
		);
		expect(r.ok).toHaveLength(2);
		expect(r.failed).toHaveLength(1);
		expect(r.outcomes[1]?.status).toBe("failed");
		expect(r.outcomes[1]?.error?.message).toBe("engine down");
	});

	it("scales to a large input without losing or reordering outcomes", async () => {
		const samples = Array.from({ length: 200 }, (_, i) => sample(`s-${i}`));
		const r = await Effect.runPromise(
			Effect.provide(
				runBatch({ items: samples, step: (s) => processSample({ sample: s }) }),
				makeLayer(),
			),
		);
		expect(r.ok).toHaveLength(200);
		expect(r.outcomes.map((o) => o.index)).toEqual(samples.map((_, i) => i));
	});

	it("converts malformed adapter output into a typed per-item failure", async () => {
		const corruptLlm = LlmPort.of({
			generate: () => Effect.die("not used"),
			correct: () =>
				Effect.succeed({
					edits: { ops: [{ at: 9_999, remove: "ghost", insert: "x", kind: "fix" as const }] },
					record: {
						runId: "r",
						taskId: "t",
						stage: "cleanup",
						engine: "stub",
						inputHash: "h",
						startedAt: 0,
					},
				}),
		});
		const r = await Effect.runPromise(
			Effect.provide(
				runBatch({
					items: [sample("s1"), sample("s2")],
					step: (s) => processSample({ sample: s }),
				}),
				Layer.merge(makeLayer(), Layer.succeed(LlmPort, corruptLlm)),
			),
		);
		// Every item hits the same corrupt adapter — all fail, each typed.
		expect(r.failed).toHaveLength(2);
		expect(r.outcomes.every((o) => o.status === "failed" && o.error instanceof PortError)).toBe(
			true,
		);
		expect(r.outcomes[0]?.error?.message).toContain("corrupt edit list");
	});

	it("surfaces a typed persistence failure without losing sibling results", async () => {
		const failingStore = DatasetStorePort.of({
			putSample: () => Effect.void,
			getSample: () => Effect.succeed(null),
			listSamples: () => Effect.succeed([]),
			putBlob: () => Effect.void,
			getBlob: () => Effect.succeed(null),
			getBlobMeta: () => Effect.succeed(null),
			putResult: () => Effect.fail(new PortError({ port: "store", message: "disk full" })),
			listResults: () => Effect.succeed([]),
		});
		const { toSampleResult, saveResult } = await import("./pipeline.ts");
		const step = (s: Sample) =>
			Effect.gen(function* () {
				const run = yield* processSample({ sample: s, runId: `run-${s.id}` });
				yield* saveResult(toSampleResult({ sample: s, runId: `run-${s.id}`, run }));
				return run;
			});
		const r = await Effect.runPromise(
			Effect.provide(
				runBatch({
					items: [sample("s1"), sample("s2")],
					step,
					options: { retry: Schedule.recurs(1) },
				}),
				Layer.merge(makeLayer(), Layer.succeed(DatasetStorePort, failingStore)),
			),
		);
		expect(r.failed).toHaveLength(2);
		expect(r.outcomes.every((o) => o.error instanceof PortError)).toBe(true);
		expect(r.outcomes[0]?.error?.message).toBe("disk full");
		expect(r.outcomes[0]?.attempts).toBe(2);
	});

	it("is deterministic — same inputs and steps give the same outcomes", async () => {
		const samples = [sample("s1"), sample("s2")];
		const batch = () =>
			Effect.provide(
				runBatch({ items: samples, step: (s) => processSample({ sample: s }) }),
				makeLayer(),
			);
		const [a, b] = await Effect.runPromise(Effect.all([batch(), batch()]));
		expect(a.ok).toEqual(b.ok);
		expect(a.failed).toEqual(b.failed);
	});
});

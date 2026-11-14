import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { BatchDefect, runBatch } from "./batch.ts";
import { processSample } from "./pipeline.ts";
import { AsrPort, DatasetStorePort, EvalPort, LlmPort, PortError, ReportPort } from "./ports.ts";
import type { Sample } from "./schema.ts";

const boom = (message = "boom") => new PortError({ port: "test", message });

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

describe("runBatch — resilience", () => {
	it("all items succeed", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["a", "b", "c"],
				step: (x) => Effect.succeed(`v-${x}`),
			}),
		);
		expect(r.ok).toEqual(["v-a", "v-b", "v-c"]);
		expect(r.failed).toEqual([]);
		expect(r.outcomes.every((o) => o.status === "ok" && o.attempts === 1)).toBe(true);
	});

	it("isolates failures — one error never aborts siblings", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["a", "bad", "c"],
				step: (x) => (x === "bad" ? Effect.fail(boom(x)) : Effect.succeed(`v-${x}`)),
			}),
		);
		expect(r.ok).toEqual(["v-a", "v-c"]);
		expect(r.failed).toEqual(["bad"]);
		const bad = r.outcomes[1]!;
		expect(bad.status).toBe("failed");
		expect(bad.error).toBeInstanceOf(PortError);
	});

	it("isolates a defecting item — siblings still complete", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["a", "bad", "c"],
				step: (x): Effect.Effect<string, PortError> =>
					x === "bad" ? Effect.die("kaput") : Effect.succeed(`v-${x}`),
				options: { retry: Schedule.recurs(2) },
			}),
		);
		expect(r.ok).toEqual(["v-a", "v-c"]);
		expect(r.failed).toEqual(["bad"]);
		const bad = r.outcomes[1]!;
		expect(bad.status).toBe("failed");
		expect(bad.error).toBeInstanceOf(BatchDefect);
		expect(bad.error?.message).toBe("kaput");
		// Defects bypass the retry schedule — they are not typed errors.
		expect(bad.attempts).toBe(1);
	});

	it("retries a flaky item and counts attempts", async () => {
		let calls = 0;
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () =>
					Effect.suspend(() => (++calls < 3 ? Effect.fail(boom("flaky")) : Effect.succeed("v-x"))),
				options: { retry: Schedule.recurs(3) },
			}),
		);
		expect(r.ok).toEqual(["v-x"]);
		expect(r.outcomes[0]?.attempts).toBe(3);
	});

	it("surfaces failure after the schedule exhausts", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () => Effect.fail(boom("always")),
				options: { retry: Schedule.recurs(2) },
			}),
		);
		expect(r.outcomes[0]?.status).toBe("failed");
		expect(r.outcomes[0]?.attempts).toBe(3); // initial + 2 recurs
		expect(r.outcomes[0]?.error?.message).toBe("always");
	});

	it("times out a hanging attempt", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () => Effect.sleep("2 seconds").pipe(Effect.as("late")),
				options: { timeoutMs: 30 },
			}),
		);
		expect(r.outcomes[0]?.status).toBe("timeout");
		expect(r.failed).toEqual(["x"]);
	});

	it("retries a timed-out attempt and recovers", async () => {
		let calls = 0;
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () =>
					Effect.suspend(() =>
						++calls === 1
							? Effect.sleep("2 seconds").pipe(Effect.as("late"))
							: Effect.succeed("v-x"),
					),
				options: { timeoutMs: 30, retry: Schedule.recurs(1) },
			}),
		);
		expect(r.outcomes[0]?.status).toBe("ok");
		expect(r.outcomes[0]?.attempts).toBe(2);
	});

	it("caps concurrency", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const r = await Effect.runPromise(
			runBatch({
				items: Array.from({ length: 10 }, (_, i) => i),
				step: () =>
					Effect.suspend(() => {
						inFlight++;
						maxInFlight = Math.max(maxInFlight, inFlight);
						return Effect.sleep("20 millis").pipe(
							Effect.tap(() => Effect.sync(() => void inFlight--)),
						);
					}),
				options: { concurrency: 3 },
			}),
		);
		expect(r.ok).toHaveLength(10);
		expect(maxInFlight).toBeLessThanOrEqual(3);
		expect(maxInFlight).toBeGreaterThan(1);
	});

	it("keeps outcomes aligned to input order even when steps resolve out of order", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: [0, 1, 2],
				step: (i) => Effect.sleep(`${(3 - i) * 10} millis`).pipe(Effect.as(i)),
			}),
		);
		expect(r.outcomes.map((o) => o.index)).toEqual([0, 1, 2]);
		expect(r.outcomes.map((o) => o.value)).toEqual([0, 1, 2]);
	});

	it("empty input returns an empty batch", async () => {
		const r = await Effect.runPromise(
			runBatch({ items: [] as string[], step: () => Effect.succeed(1) }),
		);
		expect(r.ok).toEqual([]);
		expect(r.outcomes).toEqual([]);
	});

	it("never fails the effect channel — outcomes carry the errors", async () => {
		const r = await Effect.runPromise(
			runBatch({ items: [1, 2, 3], step: () => Effect.fail(boom()) }),
		);
		expect(r.ok).toEqual([]);
		expect(r.failed).toHaveLength(3);
	});
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

	it("runs finalizers when an attempt is interrupted by timeout", async () => {
		const fin = await Effect.runPromise(Deferred.make<boolean, never>());
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () => Effect.never.pipe(Effect.ensuring(Deferred.succeed(fin, true))),
				options: { timeoutMs: 30 },
			}),
		);
		expect(r.outcomes[0]?.status).toBe("timeout");
		await Effect.runPromise(Deferred.await(fin));
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

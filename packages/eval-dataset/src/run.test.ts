import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { AsrPort, DatasetStorePort, EvalPort, LlmPort, PortError, ReportPort } from "./ports.ts";
import type { RunRecord, Sample, SampleResult } from "./schema.ts";
import { runDataset } from "./run.ts";

const persona = {
	region: "southeast",
	ageBand: "adult",
	register: "formal",
	specialty: "general_practice",
} as const;

const sample = (id: string, over: Partial<Sample> = {}): Sample => ({
	id,
	datasetVersion: "v1",
	origin: "synthetic",
	script: "Doctor: o que você está sentindo? Patient: dor de cabeça.",
	scriptHash: "h",
	persona,
	audio: { uri: "stub://audio/1" },
	gold: { validatedBy: "generator", entities: [] },
	status: "pending",
	...over,
});

const rec: RunRecord = {
	runId: "r",
	taskId: "t",
	stage: "s",
	engine: "test",
	inputHash: "h",
	latencyMs: 0,
	startedAt: 0,
};

const asrFake = Layer.succeed(
	AsrPort,
	AsrPort.of({
		transcribe: () =>
			Effect.succeed({
				asr: { text: "o que você está sentindo dor de cabeca", segments: [] },
				record: rec,
			}),
	}),
);

const llmFake = Layer.succeed(
	LlmPort,
	LlmPort.of({
		generate: () => Effect.succeed({ text: "x", record: rec }),
		correct: () => Effect.succeed({ edits: { ops: [] }, record: rec }),
	}),
);

const evalFake = Layer.succeed(
	EvalPort,
	EvalPort.of({
		judge: (input) =>
			Effect.succeed({
				answers: input.questions.map((q) => ({
					id: q.id,
					kind: q.kind,
					value: true,
					probability: 0.95,
				})),
				record: rec,
			}),
	}),
);

const reportFake = Layer.succeed(
	ReportPort,
	ReportPort.of({
		append: () => Effect.void,
		render: () => Effect.succeed(""),
	}),
);

interface StoreState {
	samples: Sample[];
	updated: Map<string, Sample>;
	results: Map<string, SampleResult>;
	putResultError?: string;
}

const storeFake = (state: StoreState) =>
	Layer.succeed(
		DatasetStorePort,
		DatasetStorePort.of({
			putSample: (s) => Effect.sync(() => void state.updated.set(s.id, s)),
			getSample: (id) =>
				Effect.succeed(
					[...state.samples, ...state.updated.values()].find((s) => s.id === id) ?? null,
				),
			listSamples: (f) =>
				Effect.succeed(
					state.samples.filter(
						(s) =>
							(f?.origin === undefined || s.origin === f.origin) &&
							(f?.datasetVersion === undefined || s.datasetVersion === f.datasetVersion),
					),
				),
			putBlob: () => Effect.void,
			getBlob: () => Effect.succeed(null),
			putResult: (r) =>
				state.putResultError !== undefined
					? Effect.fail(new PortError({ port: "store", message: state.putResultError }))
					: Effect.sync(() => void state.results.set(`${r.runId}/${r.sampleId}`, r)),
			listResults: () => Effect.succeed([...state.results.values()]),
		}),
	);

const env = (state: StoreState) =>
	Layer.mergeAll(asrFake, llmFake, evalFake, reportFake, storeFake(state));

const run = (samples: Sample[], input: Partial<Parameters<typeof runDataset>[0]> = {}) => {
	const state: StoreState = { samples, updated: new Map(), results: new Map() };
	return Effect.runPromise(
		runDataset({ runId: "run-x", ...input }).pipe(Effect.provide(env(state))),
	).then((out) => ({ out, state }));
};

describe("runDataset", () => {
	it("processes pending samples, persists results + marks processed", async () => {
		const { out, state } = await run([sample("a"), sample("b")]);
		expect(out.ok).toHaveLength(2);
		expect(state.results.size).toBe(2);
		expect(state.results.get("run-x/a")?.runId).toBe("run-x");
		expect(state.updated.get("a")?.status).toBe("processed");
	});

	it("runs pending AND failed by default — a re-run resumes", async () => {
		const { out } = await run([
			sample("a"),
			sample("b", { status: "failed", error: "earlier" }),
			sample("c", { status: "processed" }),
		]);
		expect(out.ok.map((v) => v.sampleId).sort()).toEqual(["a", "b"]);
	});

	it("reruns processed only when asked (statuses override)", async () => {
		const { out } = await run([sample("a", { status: "processed" })], {
			statuses: ["processed"],
		});
		expect(out.ok).toHaveLength(1);
	});

	it("marks failed samples so the next run retries them", async () => {
		const { out, state } = await run([sample("a", { audio: undefined })]);
		expect(out.failed).toHaveLength(1);
		expect(out.outcomes[0]?.status).toBe("failed");
		expect(state.updated.get("a")?.status).toBe("failed");
		expect(state.updated.get("a")?.error).toContain("no audio.uri");
	});

	it("sample failure does not fail siblings", async () => {
		const { out } = await run([sample("a", { audio: undefined }), sample("b")]);
		expect(out.ok).toHaveLength(1);
		expect(out.failed).toHaveLength(1);
	});

	it("honors the datasetVersion filter", async () => {
		const { out } = await run([sample("a"), sample("b", { datasetVersion: "v2" })], {
			filter: { datasetVersion: "v2" },
		});
		expect(out.ok.map((v) => v.sampleId)).toEqual(["b"]);
	});

	it("honors limit for smoke runs", async () => {
		const { out } = await run([sample("a"), sample("b"), sample("c")], { limit: 2 });
		expect(out.ok).toHaveLength(2);
	});

	it("sorts by sample id — deterministic order regardless of store", async () => {
		const { out } = await run([sample("c"), sample("a"), sample("b")]);
		expect(out.ok.map((v) => v.sampleId)).toEqual(["a", "b", "c"]);
	});

	it("samples with no status count as pending — old manifests", async () => {
		const { out } = await run([{ ...sample("a"), status: undefined }]);
		expect(out.ok).toHaveLength(1);
	});

	it("empty cohort is a no-op, not an error", async () => {
		const { out } = await run([]);
		expect(out.ok).toHaveLength(0);
		expect(out.outcomes).toHaveLength(0);
	});

	it("putResult failure isolates to the item and marks it failed", async () => {
		const state: StoreState = {
			samples: [sample("a")],
			updated: new Map(),
			results: new Map(),
			putResultError: "store full",
		};
		const out = await Effect.runPromise(
			runDataset({ runId: "run-x" }).pipe(Effect.provide(env(state))),
		);
		expect(out.failed).toHaveLength(1);
		expect(state.updated.get("a")?.status).toBe("failed");
		expect(state.updated.get("a")?.error).toBe("store full");
	});
});

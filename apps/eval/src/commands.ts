/**
 * eval CLI commands — composition root for the evaluation pipeline.
 * Orchestration lives in @ktb/eval-dataset; adapters in
 * eval-dataset-local/stub. This file only wires flags → layers.
 */
import { Command, Flag } from "effect/cli";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as fs from "node:fs";
import * as Layer from "effect/Layer";
import * as path from "node:path";
import * as Schedule from "effect/Schedule";

import {
	type AcousticProfile,
	DatasetStorePort,
	DEFAULT_MATRIX,
	decideAutoAccept,
	gateRun,
	generateDataset,
	type Persona,
	runDataset,
	sampleMatrix,
	TtsPort,
} from "@ktb/eval-dataset";
import { makeStubAsr, makeStubEval, makeStubLlm } from "@ktb/eval-dataset-stub";
import {
	makeJevEval,
	makeLocalAsr,
	makeLocalReportLayer,
	makeLocalStoreLayer,
	makeLocalTts,
} from "@ktb/eval-dataset-local";

const TEMPLATES = new URL("../../../packages/eval-dataset/templates/", import.meta.url);

const out = (line: string) => Effect.sync(() => console.log(line));

/** Outcome tags — pure so every status/attempts branch is unit-testable. */
export const formatGenOutcome = (o: {
	readonly status: string;
	readonly error?: { readonly message: string } | undefined;
}): string =>
	o.status === "ok"
		? "ok"
		: o.status === "failed"
			? `FAIL ${o.error?.message ?? "unknown"}`
			: "TIMEOUT";

export const formatRunOutcome = (o: {
	readonly status: string;
	readonly error?: { readonly message: string } | undefined;
}): string =>
	o.status === "ok" ? "ok" : `${o.status}${o.error !== undefined ? ` — ${o.error.message}` : ""}`;

// -- generate -----------------------------------------------------------------

const generate = Command.make(
	"generate",
	{
		workdir: Flag.withDefault(Flag.String("workdir"), "/tmp/eval-generate"),
		personas: Flag.withDefault(Flag.Int("personas"), 8),
		seed: Flag.withDefault(Flag.Int("seed"), 100),
		step: Flag.withDefault(Flag.Int("step"), 7),
		template: Flag.withDefault(Flag.String("template"), "consultation"),
		noise: Flag.withDefault(Flag.Literals("noise", ["clean", "clinic", "street"]), "clean"),
		tts: Flag.withDefault(Flag.Literals("tts", ["stub", "edge"]), "stub"),
		concurrency: Flag.withDefault(Flag.Int("concurrency"), 2),
	},
	(c) =>
		Effect.gen(function* () {
			const template = fs.readFileSync(new URL(`${c.template}.eta`, TEMPLATES), "utf8");
			const personas = sampleMatrix(DEFAULT_MATRIX, c.step).slice(0, c.personas);
			const voices = ["br_male_1", "br_female_1"];
			const acoustic = (_p: Persona, i: number): AcousticProfile => ({
				ttsModel: c.tts,
				voiceId: voices[i % voices.length]!,
				noise: c.noise as AcousticProfile["noise"],
				sampleRate: 16000,
			});
			const store = makeLocalStoreLayer(c.workdir);
			const report = makeLocalReportLayer(path.join(c.workdir, "reports", "generate.jsonl"));
			const tts =
				c.tts === "edge"
					? makeLocalTts({ workDir: path.join(c.workdir, "tts"), voiceMap: {} })
					: Layer.succeed(
							TtsPort,
							TtsPort.of({
								synthesize: ({ voiceId }) =>
									Effect.succeed({
										audio: { uri: `stub://tts/${voiceId}`, size: 8 },
										record: {
											runId: "gen",
											taskId: voiceId,
											stage: "synthesize",
											engine: "stub-tts",
											inputHash: "h",
											startedAt: Date.now(),
										},
									}),
							}),
						);
			const result = yield* generateDataset({
				datasetVersion: `gen-${new Date().toISOString().slice(0, 10)}`,
				personas,
				template,
				acoustic,
				seed: c.seed,
				batch: {
					concurrency: c.concurrency,
					retry: Schedule.exponential("300 millis").pipe(Schedule.upTo({ times: 2 })),
					timeoutMs: 120_000,
				},
			}).pipe(Effect.provide(Layer.mergeAll(store, report, tts)));
			for (const o of result.outcomes) {
				const mark = formatGenOutcome(o);
				yield* out(
					`  [${o.index}] ${o.item.region}/${o.item.specialty} — ${mark} (${o.attempts} attempts)`,
				);
			}
			yield* out(
				`\n${result.ok.length} persisted, ${result.failed.length} failed in ${result.latencyMs}ms → ${c.workdir}`,
			);
		}),
);

// -- run ----------------------------------------------------------------------

const run = Command.make(
	"run",
	{
		workdir: Flag.withDefault(Flag.String("workdir"), "/tmp/eval-generate"),
		runId: Flag.optional(Flag.String("run-id")),
		asr: Flag.withDefault(Flag.String("asr"), "stub"),
		llm: Flag.withDefault(Flag.Literals("llm", ["stub"]), "stub"),
		judge: Flag.withDefault(Flag.String("judge"), "stub"),
		datasetVersion: Flag.optional(Flag.String("dataset-version")),
		all: Flag.withDefault(Flag.Boolean("all"), false),
		limit: Flag.withDefault(Flag.Int("limit"), 0),
		concurrency: Flag.withDefault(Flag.Int("concurrency"), 1),
		retry: Flag.withDefault(Flag.Int("retry"), 0),
		timeoutMs: Flag.withDefault(Flag.Int("timeout-ms"), 120_000),
	},
	(c) =>
		Effect.gen(function* () {
			const datasetVersion = Option.getOrUndefined(c.datasetVersion);
			const runId =
				Option.getOrUndefined(c.runId) ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
			const asr =
				c.asr === "stub" ? makeStubAsr() : makeLocalAsr({ baseUrl: c.asr, timeoutMs: c.timeoutMs });
			const judge = c.judge === "stub" ? makeStubEval() : makeJevEval({ baseUrl: c.judge });
			const llm = makeStubLlm();
			const store = makeLocalStoreLayer(c.workdir);
			const report = makeLocalReportLayer(path.join(c.workdir, "reports", `${runId}.jsonl`));
			const statuses = c.all
				? (["pending", "failed", "processed", "approved"] as const)
				: undefined;
			const res = yield* runDataset({
				runId,
				...(datasetVersion !== undefined ? { filter: { datasetVersion } } : {}),
				...(statuses !== undefined ? { statuses } : {}),
				...(c.limit > 0 ? { limit: c.limit } : {}),
				batch: {
					concurrency: c.concurrency,
					timeoutMs: c.timeoutMs,
					...(c.retry > 0 ? { retry: Schedule.recurs(c.retry) } : {}),
				},
			}).pipe(
				Effect.provide(asr),
				Effect.provide(judge),
				Effect.provide(llm),
				Effect.provide(store),
				Effect.provide(report),
			);
			for (const o of res.outcomes) {
				const tag = formatRunOutcome(o);
				yield* out(
					`  ${o.item.id}: ${tag} (${o.attempts} attempt${o.attempts === 1 ? "" : "s"}, ${o.latencyMs}ms)`,
				);
			}
			yield* out(
				`\n${res.ok.length} ok / ${res.failed.length} failed — runId ${runId} (${res.latencyMs}ms)`,
			);
			if (res.outcomes.length === 0) {
				yield* out("no eligible samples — check workdir, datasetVersion and statuses");
			}
		}),
);

// -- gate ---------------------------------------------------------------------

const gate = Command.make(
	"gate",
	{
		workdir: Flag.withDefault(Flag.String("workdir"), "/tmp/eval-generate"),
		stage: Flag.withDefault(Flag.Literals("stage", ["asr", "corrected"]), "corrected"),
		maxWer: Flag.withDefault(Flag.String("max-wer"), "0.05"),
		target: Flag.withDefault(Flag.String("target"), "0.95"),
		minN: Flag.withDefault(Flag.Int("min-n"), 30),
		maxRisk: Flag.withDefault(Flag.Int("max-risk"), 0),
		enforce: Flag.withDefault(Flag.Boolean("enforce"), false),
	},
	(c) =>
		Effect.gen(function* () {
			const policy = {
				stage: c.stage,
				maxWer: Number(c.maxWer),
				target: Number(c.target),
				minN: c.minN,
				maxRisk: c.maxRisk,
			};
			const results = yield* Effect.gen(function* () {
				const store = yield* DatasetStorePort;
				return yield* store.listResults();
			}).pipe(Effect.provide(makeLocalStoreLayer(c.workdir)));
			if (results.length === 0) {
				yield* out(`no results under ${c.workdir} — nothing to gate`);
				return;
			}
			const gateRes = gateRun(results, policy);
			for (const r of results) {
				const d = decideAutoAccept(r, policy);
				yield* out(`  ${r.sampleId}: ${d.accept ? "accept" : `REJECT — ${d.reasons.join("; ")}`}`);
			}
			yield* out(
				`\n${gateRes.accepted}/${results.length} accepted — run is ${gateRes.green ? "GREEN" : "RED"} (stage=${policy.stage}, wer≤${policy.maxWer}, floor≥${policy.target}@n≥${policy.minN}, risk≤${policy.maxRisk})`,
			);
			if (c.enforce && !gateRes.green) {
				yield* Effect.sync(() => {
					process.exitCode = 1;
				});
			}
		}),
);

export const cli = Command.make("eval").pipe(Command.withSubcommands([generate, run, gate]));

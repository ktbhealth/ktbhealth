/**
 * run — execute a suite's pipeline over the persisted dataset.
 *
 *   eval run <suite> [--profile p] [--workdir d] [--run-id id]
 *     [--limit N] [--concurrency N] [--locale pt-BR]
 *
 * Samples are read from the suite's datasetVersion pin in the local
 * store (run `generate` first), then each goes through
 * processSample — transcribe → cleanup → judge — with every
 * RunRecord appended to the report and every SampleResult persisted.
 * Resilience is runBatch's: bounded concurrency, retry schedule,
 * per-attempt timeout, per-sample failure isolation.
 */

import * as Effect from "effect/Effect";
import { Console, Option } from "effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { Argument, Command, Flag } from "effect/cli";

import { runBatch } from "@ktb/eval-core";
import {
	DatasetStorePort,
	processSample,
	recordAll,
	sampleForPersistence,
	saveResult,
	saveSample,
	toSampleResult,
	type Sample,
} from "@ktb/eval-consult";

import { modelLayer, storeReportLayers, type WireContext } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { CommandExit } from "../errors.ts";
import { findSuite } from "../suites.ts";
import {
	assertCapabilities,
	datasetVersionOf,
	intFlag,
	isTransientBatchError,
	localeFlag,
	outcomeMark,
	resolveFor,
	selectProfile,
	userError,
	workdirFlag,
} from "../shared.ts";

const optStr = Option.getOrUndefined;

interface RunValue {
	readonly sampleId: string;
	readonly werAsr: number;
	readonly werCorrected: number;
}

export const makeRunCommand = (ctx: CmdContext) =>
	Command.make(
		"run",
		{
			suite: Argument.String("suite"),
			profile: Flag.optional(Flag.String("profile")),
			workdir: Flag.optional(Flag.String("workdir")),
			runId: Flag.optional(Flag.String("run-id")),
			limit: Flag.optional(Flag.Int("limit")),
			concurrency: Flag.optional(Flag.Int("concurrency")),
			locale: Flag.optional(Flag.String("locale")),
		},
		(cfg) =>
			Effect.gen(function* () {
				const suite = yield* Effect.tryPromise({
					try: () => findSuite(ctx.evalsDir, cfg.suite),
					catch: userError,
				});
				const manifest = suite.manifest;
				const profile = yield* selectProfile(cfg.profile, suite);
				const { resolution } = resolveFor(suite, profile);
				yield* assertCapabilities(suite, resolution, ["asr", "llm", "eval"]);

				const workdir = yield* workdirFlag(cfg.workdir);
				const concurrency = yield* intFlag("concurrency", cfg.concurrency, 2, 1);
				const limit = yield* intFlag("limit", cfg.limit, 0, 1);
				const runId = optStr(cfg.runId) ?? `run-${manifest.id}-${Date.now()}`;
				const datasetVersion = datasetVersionOf(manifest);
				// Same --locale registry generate uses — the scrub
				// patterns and normalization must match the locale the
				// dataset was generated under.
				const locale = yield* localeFlag(cfg.locale);

				const wire: WireContext = {
					workdir,
					profile,
					env: ctx.env,
					...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
				};
				const { store, report } = storeReportLayers(workdir);

				// Read the cohort first — an empty dataset is a hard
				// "generate first" error, not a vacuous green run.
				const samples = yield* Effect.scoped(
					Effect.gen(function* () {
						const s = yield* DatasetStorePort;
						return yield* s.listSamples({ datasetVersion });
					}).pipe(Effect.provide(store)),
				);
				const cohort = limit === 0 ? samples : samples.slice(0, limit);
				if (cohort.length === 0) {
					yield* Console.log(
						`no samples for datasetVersion "${datasetVersion}" under ${workdir} — run generate first`,
					);
					return yield* new CommandExit({ code: 1 });
				}

				// modelLayer throws on undeclared/unimplemented adapters —
				// lift it into the error channel (exit 1, message shown).
				const layer = yield* Effect.try({
					try: () =>
						Layer.mergeAll(
							modelLayer(wire, resolution.adapters, "asr"),
							modelLayer(wire, resolution.adapters, "llm"),
							modelLayer(wire, resolution.adapters, "eval"),
							store,
							report,
						),
					catch: userError,
				});

				const step = (sample: Sample) =>
					Effect.gen(function* () {
						const run = yield* processSample({ sample, runId, profile: locale });
						yield* recordAll(run.records);
						yield* saveResult(toSampleResult({ sample, runId, run }));
						yield* saveSample(sampleForPersistence(sample, run));
						return {
							sampleId: sample.id,
							werAsr: run.asrMetrics.wer,
							werCorrected: run.correctedMetrics.wer,
						} satisfies RunValue;
					});

				const result = yield* Effect.scoped(
					Effect.gen(function* () {
						return yield* runBatch({
							items: cohort,
							options: {
								concurrency,
								retry: Schedule.exponential("300 millis").pipe(Schedule.upTo({ times: 2 })),
								retryWhile: isTransientBatchError,
								timeoutMs: 120_000,
							},
							step,
						});
					}).pipe(Effect.provide(layer)),
				);

				for (const o of result.outcomes) {
					const mark = outcomeMark(
						o,
						(v) => `ok WER ${v.werAsr.toFixed(3)}→${v.werCorrected.toFixed(3)}`,
					);
					yield* Console.log(`  [${o.index}] ${o.item.id} — ${mark} (${o.attempts} attempts)`);
				}
				yield* Console.log(
					`\nrun ${runId}: ${result.ok.length}/${cohort.length} processed, ` +
						`${result.failed.length} failed in ${result.latencyMs}ms → ${workdir}`,
				);
				if (result.failed.length > 0) {
					return yield* new CommandExit({ code: 1 });
				}
			}),
	).pipe(Command.withDescription("transcribe → cleanup → judge over the persisted cohort."));

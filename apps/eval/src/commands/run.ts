/**
 * run — execute a suite's pipeline over the persisted dataset
 * (P-074 phase 4).
 *
 *   eval run <suite> [--profile p] [--workdir d] [--run-id id]
 *     [--limit N] [--concurrency N]
 *
 * Samples are read from the suite's datasetVersion pin in the local
 * store (run `generate` first), then each goes through
 * processSample — transcribe → cleanup → judge — with every
 * RunRecord appended to the report and every SampleResult persisted.
 * Resilience is runBatch's: bounded concurrency, retry schedule,
 * per-attempt timeout, per-sample failure isolation.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { runBatch } from "@ktb/eval-core";
import {
	DatasetStorePort,
	processSample,
	ptBR,
	recordAll,
	sampleForPersistence,
	saveResult,
	saveSample,
	toSampleResult,
	type LocaleProfile,
	type Sample,
} from "@ktb/eval-consult";

import { intFlag, parseArgs, strFlag } from "../args.ts";
import { modelLayer, storeReportLayers, type WireContext } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { findSuite } from "../suites.ts";
import {
	assertCapabilities,
	datasetVersionOf,
	outcomeMark,
	resolveFor,
	selectProfile,
	workdirFlag,
} from "../shared.ts";

const SPEC = {
	positionals: ["suite"],
	flags: {
		profile: "string",
		workdir: "string",
		"run-id": "string",
		limit: "int",
		concurrency: "int",
	},
} as const;

interface RunValue {
	readonly sampleId: string;
	readonly werAsr: number;
	readonly werCorrected: number;
}

export const runCommand = async (argv: readonly string[], ctx: CmdContext): Promise<number> => {
	const args = parseArgs(argv, SPEC);
	const suite = await findSuite(ctx.evalsDir, args.positional.suite!);
	const manifest = suite.manifest;
	const profile = selectProfile(args, suite);
	const { resolution } = resolveFor(suite, profile);
	assertCapabilities(suite, resolution, ["asr", "llm", "eval"]);

	const workdir = workdirFlag(args);
	const concurrency = intFlag(args, "concurrency", 2, 1);
	const limit = args.flags.limit !== undefined ? intFlag(args, "limit", 0, 1) : undefined;
	const runId = strFlag(args, "run-id") ?? `run-${manifest.id}-${Date.now()}`;
	const datasetVersion = datasetVersionOf(manifest);
	const locale: LocaleProfile = ptBR;

	const wire: WireContext = {
		workdir,
		profile,
		env: ctx.env,
		...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
	};
	const { store, report } = storeReportLayers(workdir);

	// Read the cohort first — an empty dataset is a hard "generate
	// first" error, not a vacuous green run.
	const samples = await Effect.runPromise(
		Effect.gen(function* () {
			const s = yield* DatasetStorePort;
			return yield* s.listSamples({ datasetVersion });
		}).pipe(Effect.provide(store)),
	);
	const cohort = limit === undefined ? samples : samples.slice(0, limit);
	if (cohort.length === 0) {
		console.log(
			`no samples for datasetVersion "${datasetVersion}" under ${workdir} — run generate first`,
		);
		return 1;
	}

	const layer = Layer.mergeAll(
		modelLayer(wire, resolution.adapters, "asr"),
		modelLayer(wire, resolution.adapters, "llm"),
		modelLayer(wire, resolution.adapters, "eval"),
		store,
		report,
	);

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

	const result = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				return yield* runBatch({
					items: cohort,
					options: {
						concurrency,
						retry: Schedule.exponential("300 millis").pipe(Schedule.upTo({ times: 2 })),
						timeoutMs: 120_000,
					},
					step,
				});
			}).pipe(Effect.provide(layer)),
		),
	);

	for (const o of result.outcomes) {
		const mark = outcomeMark(
			o,
			(v) => `ok WER ${v.werAsr.toFixed(3)}→${v.werCorrected.toFixed(3)}`,
		);
		console.log(`  [${o.index}] ${o.item.id} — ${mark} (${o.attempts} attempts)`);
	}
	console.log(
		`\nrun ${runId}: ${result.ok.length}/${cohort.length} processed, ` +
			`${result.failed.length} failed in ${result.latencyMs}ms → ${workdir}`,
	);
	return result.failed.length > 0 ? 1 : 0;
};

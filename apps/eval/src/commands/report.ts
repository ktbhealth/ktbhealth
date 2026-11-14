/**
 * report — render a persisted run's records + result summary.
 *
 *   eval report <suite> [--workdir d] [--run-id id]
 *
 * Without --run-id the most recent runId in the store is rendered
 * (max SampleResult.createdAt). Output is the ReportPort markdown
 * (renderRunMarkdown — the port contract) plus a one-line cohort
 * summary.
 */

import * as Effect from "effect/Effect";
import { Console, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { DatasetStorePort, ReportPort } from "@ktb/eval-consult";

import { storeReportLayers } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { findSuite } from "../suites.ts";
import { datasetVersionOf, userError, workdirFlag } from "../shared.ts";

const optStr = Option.getOrUndefined;

export const makeReportCommand = (ctx: CmdContext) =>
	Command.make(
		"report",
		{
			suite: Argument.String("suite"),
			workdir: Flag.optional(Flag.String("workdir")),
			runId: Flag.optional(Flag.String("run-id")),
		},
		(cfg) =>
			Effect.gen(function* () {
				// Validate the suite exists even though the report renders
				// stored data — a typo'd suite id should fail, not render a
				// stranger's run.
				const suite = yield* Effect.tryPromise({
					try: () => findSuite(ctx.evalsDir, cfg.suite),
					catch: userError,
				});
				const workdir = yield* workdirFlag(cfg.workdir);
				const { store, report } = storeReportLayers(workdir);

				const all = yield* Effect.scoped(
					Effect.gen(function* () {
						const s = yield* DatasetStorePort;
						return yield* s.listResults();
					}).pipe(Effect.provide(store)),
				);
				// Scope to THIS suite's dataset pin — the workdir is shared
				// across suites/versions; "latest run" must mean latest
				// run OF THIS DATASET, not of whatever wrote last.
				// Unstamped results predate attribution and match nothing.
				const datasetVersion = datasetVersionOf(suite.manifest);
				const results = all.filter((r) => r.datasetVersion === datasetVersion);
				if (results.length === 0) {
					yield* Console.log(
						`no results for dataset "${datasetVersion}" under ${workdir}` +
							(all.length > 0 ? ` — ${all.length} result(s) belong to other datasets` : "") +
							" — nothing to report",
					);
					return;
				}

				const runId =
					optStr(cfg.runId) ?? results.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).runId;
				const forRun = results.filter((r) => r.runId === runId);

				const markdown = yield* Effect.scoped(
					Effect.gen(function* () {
						const r = yield* ReportPort;
						return yield* r.render(runId);
					}).pipe(Effect.provide(report)),
				);

				const meanWer =
					forRun.length === 0
						? null
						: forRun.reduce((acc, r) => acc + (r.correctedMetrics?.wer ?? 0), 0) / forRun.length;
				yield* Console.log(markdown);
				yield* Console.log(
					`run ${runId}: ${forRun.length} result(s)` +
						(meanWer !== null ? `, mean corrected WER ${meanWer.toFixed(3)}` : ""),
				);
			}),
	).pipe(Command.withDescription("Render a run's markdown report + cohort summary."));

/**
 * report — render a persisted run's records + result summary, or diff
 * two tracked experiments.
 *
 *   eval report <suite> [--workdir d] [--run-id id]
 *   eval report <suite> --compare <expA> --compare <expB> [--workdir d]
 *
 * Without --run-id the most recent runId in the store is rendered
 * (max SampleResult.createdAt). Output is the ReportPort markdown
 * (renderRunMarkdown — the port contract) plus a one-line cohort
 * summary.
 *
 * --compare (P-076) switches to experiment mode: the flag repeats —
 * exactly two experiment ids are required — and the output is the
 * eval-core experiment diff (identity fields + summary metrics +
 * per-gate verdicts) as markdown. The <suite> argument still
 * validates the suite exists; experiments are looked up by id in the
 * workdir's EvalStorePort regardless of which suite produced them
 * (their suiteId is shown in the output).
 */

import * as Effect from "effect/Effect";
import { Console, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { diffExperiments, EvalStorePort, renderExperimentCompareMarkdown } from "@ktb/eval-core";
import { DatasetStorePort, ReportPort } from "@ktb/eval-consultation";

import { storeReportLayers } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { UsageError } from "../errors.ts";
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
			compare: Flag.optional(Flag.String("compare").pipe(Flag.atLeast(2))),
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
				const { store, report, evalStore } = storeReportLayers(workdir);

				// ---- experiment compare mode ----
				const compareIds = Option.getOrUndefined(cfg.compare);
				if (compareIds !== undefined) {
					if (compareIds.length !== 2) {
						return yield* new UsageError({
							message: `--compare takes exactly two experiment ids, got ${compareIds.length}`,
						});
					}
					const experiments = yield* Effect.scoped(
						Effect.gen(function* () {
							const s = yield* EvalStorePort;
							const a = yield* s.getExperiment(compareIds[0]!);
							const b = yield* s.getExperiment(compareIds[1]!);
							return { a, b };
						}).pipe(Effect.provide(evalStore)),
					);
					if (experiments.a === null || experiments.b === null) {
						const missing = experiments.a === null ? compareIds[0]! : compareIds[1]!;
						return yield* userError(
							new Error(
								`experiment "${missing}" not found under ${workdir} — ` +
									`run \`eval run\`/\`eval generate\` first (or check --workdir)`,
							),
						);
					}
					yield* Console.log(
						renderExperimentCompareMarkdown(diffExperiments(experiments.a, experiments.b)),
					);
					return;
				}

				// ---- run report mode ----
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
	).pipe(
		Command.withDescription(
			"Render a run's markdown report + cohort summary, or --compare two experiment ids.",
		),
	);

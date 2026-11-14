/**
 * run — execute a suite's pipeline over the persisted dataset.
 *
 *   eval run <suite> [--profile p] [--workdir d] [--run-id id]
 *     [--limit N] [--concurrency N] [--locale pt-BR]
 *
 * Samples are read from the suite's datasetVersion pin in the local
 * store (run `generate` first), then each goes through
 * processSample — the manifest's run-stage subset dispatched in
 * declared order (transcribe → cleanup → judge is the canonical
 * dependency order; a selection may narrow it, never reorder it) —
 * with every RunRecord appended to the report and every
 * SampleResult persisted. Resilience is runBatch's: bounded
 * concurrency, retry schedule, per-attempt timeout, per-sample
 * failure isolation.
 *
 * Cross-suite inputs (P-077): manifest `inputs` refs resolve to
 * prior SampleResults before the run; a resolved `asrText` input
 * lets the selection omit "transcribe" (priorAsrText replaces it —
 * mutually exclusive with live transcription). The consultation
 * runner is linear-only: non-linear stage DAG features are a usage
 * error. Resolved inputs become Experiment.derivedFrom lineage.
 */

import * as Effect from "effect/Effect";
import { Console, Option } from "effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { Argument, Command, Flag } from "effect/cli";

import { EvalStorePort, runBatch, stageIdsOf, stageNodesOf, type Experiment } from "@ktb/eval-core";
import {
	DatasetStorePort,
	GENERATION_STAGES,
	isRunStage,
	processSample,
	recordAll,
	runStageSelection,
	sampleForPersistence,
	saveResult,
	saveSample,
	toSampleResult,
	type RunRecord,
	type Sample,
} from "@ktb/eval-consultation";

import { modelLayer, storeReportLayers, type WireContext } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { domainErrorMessage, domainForManifest, loadDomains } from "../domains.ts";
import { CommandExit, UsageError } from "../errors.ts";
import { inputFieldOf, resolveSuiteInputs } from "../inputs.ts";
import { findSuite } from "../suites.ts";
import {
	assertCapabilities,
	datasetVersionOf,
	gitSha,
	intFlag,
	isTransientBatchError,
	localeSelection,
	manifestHashOf,
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
	/** Absent when the manifest's stage selection stops before
	 * cleanup — there is no corrected text to score. */
	readonly werCorrected?: number;
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
				// Domain definition (P-079): resolves the manifest's
				// `domain` id (extends chain + domainParams overrides).
				// The merged `params` record is threaded into
				// processSample as `domainParams` — the pack reads its
				// own keys (e.g. entityCategories). Absent definition →
				// pre-P-079 defaults; invalid domainParams is a manifest
				// bug → usage error.
				const domains = yield* Effect.tryPromise({
					try: () => loadDomains(ctx.evalsDir),
					catch: userError,
				});
				const effDomain = yield* Effect.try({
					try: () => domainForManifest(domains, manifest),
					catch: (e) => new UsageError({ message: domainErrorMessage(e) }),
				});
				yield* assertCapabilities(suite, resolution, ["asr", "llm", "eval"]);
				// Contribution config validation (P-078): a manifest
				// `config` that fails its contribution's declared
				// validator is a manifest bug — fail before any work,
				// same rule as malformed gate params.
				if (resolution.configErrors.length > 0) {
					return yield* new UsageError({
						message:
							`suite "${manifest.id}" has invalid contribution config: ` +
							resolution.configErrors.map((e) => `${e.kind} "${e.id}": ${e.error}`).join("; "),
					});
				}

				const workdir = yield* workdirFlag(cfg.workdir);
				const concurrency = yield* intFlag("concurrency", cfg.concurrency, 2, 1);
				const limit = yield* intFlag("limit", cfg.limit, 0, 1);
				const runId = optStr(cfg.runId) ?? `run-${manifest.id}-${Date.now()}`;
				const startedAt = Date.now();
				const datasetVersion = datasetVersionOf(manifest);
				// Same --locale resolution generate uses — the scrub
				// patterns and normalization must match the locale the
				// dataset was generated under (domain default, flag wins).
				const localeSel = yield* localeSelection(effDomain, cfg.locale);

				const wire: WireContext = {
					workdir,
					profile,
					env: ctx.env,
					...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
				};
				const { store, report, evalStore } = storeReportLayers(workdir);

				// Cross-suite inputs (P-077): resolve declared refs
				// against already-persisted results BEFORE stage
				// validation — a resolved asrText input relaxes the
				// must-include-transcribe rule. Unresolvable refs are
				// fatal: inputs are never fabricated.
				const inputBundles = yield* resolveSuiteInputs(ctx.evalsDir, manifest).pipe(
					Effect.provide(store),
					Effect.mapError(userError),
				);
				const needsPriorAsr = inputBundles.some((b) => inputFieldOf(b.input) === "asrText");

				// Manifest stage dispatch: `eval run` executes the
				// manifest's run-stage subset in declared order —
				// transcribe → cleanup → judge is the canonical
				// dependency order, so a selection may narrow the
				// pipeline (skip judge, transcribe-only) but never
				// reorder it. Generation stages (script_gen,
				// synthesize) belong to `eval generate`; any other
				// non-run id has no runner and fails loudly instead
				// of being silently skipped. An inconsistent
				// selection is a manifest bug → usage error (exit 2),
				// same rule as malformed gate params. Stage entries may
				// be DAG nodes (P-077) — only their ids dispatch here;
				// the consultation runner is linear-only, so non-linear
				// graphs fail the order check below.
				const stageIds = stageIdsOf(manifest.stages);
				const unrunnable = stageIds.filter(
					(s) => !isRunStage(s) && !(GENERATION_STAGES as readonly string[]).includes(s),
				);
				if (unrunnable.length > 0) {
					return yield* userError(
						new Error(
							`suite "${manifest.id}" stage(s) have no eval-run runner: ${unrunnable.join(", ")}`,
						),
					);
				}
				// The consultation runner is LINEAR-ONLY: RUN_STAGE_FNS
				// share one mutable StageRun, so parallel branches,
				// condition guards, and optional-tolerance semantics
				// have no honest execution here. A node entry is
				// accepted only when its resolved needs are exactly the
				// linear-chain default (every earlier stage id) and it
				// declares no optional/when — anything else is a
				// manifest bug, never silently ignored.
				const nonLinear = stageNodesOf(manifest.stages).some((n, i) => {
					if (n.optional === true || n.when !== undefined) return true;
					if (n.needs === undefined) return false;
					const earlier = new Set(stageIds.slice(0, i));
					return n.needs.length !== earlier.size || !n.needs.every((d) => earlier.has(d));
				});
				if (nonLinear) {
					return yield* new UsageError({
						message:
							`suite "${manifest.id}" declares a non-linear stage graph — ` +
							"the consultation runner executes run stages sequentially " +
							"(parallel/conditional/optional stages need a DAG-aware domain runner)",
					});
				}
				// Prior ASR text and a live transcribe are mutually
				// exclusive — picking one silently would lie about
				// which artifact the downstream stages consumed.
				if (needsPriorAsr && stageIds.includes("transcribe")) {
					return yield* new UsageError({
						message:
							`suite "${manifest.id}" declares an asrText input AND selects "transcribe" — ` +
							"prior text and live transcription are mutually exclusive",
					});
				}
				const stages = yield* Effect.try({
					try: () => runStageSelection(stageIds, { requireTranscribe: !needsPriorAsr }),
					catch: (e) =>
						new UsageError({
							/* v8 ignore next -- runStageSelection only throws Error */
							message: e instanceof Error ? e.message : String(e),
						}),
				});

				// Materialize prior asrText per sample — first declared
				// input wins on duplicate sampleIds (manifest order is
				// the tiebreak, documented in inputs.ts).
				const priorAsrBySample = new Map<string, string>();
				for (const b of inputBundles) {
					if (inputFieldOf(b.input) !== "asrText") continue;
					for (const r of b.rows) {
						if (!priorAsrBySample.has(r.sampleId)) {
							priorAsrBySample.set(r.sampleId, r.asrText);
						}
					}
				}

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
							evalStore,
						),
					catch: userError,
				});

				const step = (sample: Sample) =>
					Effect.gen(function* () {
						// Partial-audit collector: processSample pushes every
						// stage record here AS PRODUCED, so a mid-pipeline
						// failure still leaves its ASR/cleanup/judge records
						// on the report. `persisted` marks what recordAll
						// already wrote — the exit path appends only the
						// unwritten tail. A retried attempt collects from
						// scratch, so earlier attempts' records stay as
						// their own honest audit entries.
						const collected: RunRecord[] = [];
						let persisted = 0;
						const attempt = Effect.gen(function* () {
							// Samples absent from the source run get no
							// prior text — processSample then fails them
							// honestly (transcribe-less selection requires
							// priorAsrText), never fabricating output.
							const priorAsrText = needsPriorAsr ? priorAsrBySample.get(sample.id) : undefined;
							const run = yield* processSample({
								sample,
								runId,
								stages,
								profile: localeSel.profile,
								recordsOut: collected,
								...(priorAsrText !== undefined ? { priorAsrText } : {}),
								...(effDomain?.definition.params !== undefined
									? { domainParams: effDomain.definition.params }
									: {}),
							});
							yield* recordAll(run.records);
							persisted = collected.length;
							yield* saveResult(toSampleResult({ sample, runId, run }));
							yield* saveSample(sampleForPersistence(sample, run));
							return {
								sampleId: sample.id,
								werAsr: run.asrMetrics.wer,
								...(run.correctedMetrics !== undefined
									? { werCorrected: run.correctedMetrics.wer }
									: {}),
							} satisfies RunValue;
						});
						return yield* attempt.pipe(
							Effect.onExit(() =>
								// Best-effort: the audit append must never mask
								// the original failure — ignore swallows even a
								// broken report sink. On success `persisted` ===
								// collected.length, so this is a no-op.
								Effect.ignore(recordAll(collected.slice(persisted))),
							),
						);
					});

				const result = yield* Effect.scoped(
					Effect.gen(function* () {
						const r = yield* runBatch({
							items: cohort,
							options: {
								concurrency,
								retry: Schedule.exponential("300 millis").pipe(Schedule.upTo({ times: 2 })),
								retryWhile: isTransientBatchError,
								timeoutMs: 120_000,
							},
							step,
						});

						// Experiment tracking (P-076): every completed run
						// records its identity + summary metrics — mean
						// WER per stage, ok/failed counts, latency — so
						// `eval report --compare` can diff runs.
						const okValues = r.ok;
						const mean = (f: (v: RunValue) => number | undefined): number | undefined => {
							const xs = okValues.map(f).filter((x): x is number => x !== undefined);
							return xs.length === 0 ? undefined : xs.reduce((acc, x) => acc + x, 0) / xs.length;
						};
						const meanWerAsr = mean((v) => v.werAsr);
						const meanWerCorrected = mean((v) => v.werCorrected);
						const sha = gitSha(ctx.repoRoot);
						// Cross-suite lineage (P-077): the source runs this
						// experiment's inputs were materialized from.
						const derivedFrom = [...new Set(inputBundles.map((b) => b.runId))];
						const experiment: Experiment = {
							id: runId,
							kind: "run",
							suiteId: manifest.id,
							manifestHash: manifestHashOf(manifest),
							...(sha !== undefined
								? { gitSha: sha }
								: /* v8 ignore next -- gitSha is only undefined outside a git checkout or without git; tests always run inside the repo */ {}),
							profile,
							dataset: { id: manifest.dataset.id, version: manifest.dataset.version },
							startedAt,
							finishedAt: Date.now(),
							...(derivedFrom.length > 0 ? { derivedFrom } : {}),
							summary: {
								samples: cohort.length,
								ok: okValues.length,
								failed: r.failed.length,
								latencyMs: r.latencyMs,
								datasetVersion,
								stages: stages.join(","),
								...(inputBundles.length > 0
									? {
											inputs: inputBundles.map((b) => ({
												ref: b.label,
												suite: b.suiteId,
												runId: b.runId,
												datasetVersion: b.datasetVersion,
												rows: b.rows.length,
											})),
										}
									: {}),
								...(meanWerAsr !== undefined ? { meanWerAsr } : {}),
								...(meanWerCorrected !== undefined ? { meanWerCorrected } : {}),
								...(effDomain?.definition.params !== undefined
									? { domainParams: effDomain.definition.params }
									: {}),
							},
						};
						const evals = yield* EvalStorePort;
						yield* evals.putExperiment(experiment).pipe(Effect.mapError(userError));
						return r;
					}).pipe(Effect.provide(layer)),
				);

				for (const o of result.outcomes) {
					const mark = outcomeMark(o, (v) =>
						v.werCorrected === undefined
							? `ok WER ${v.werAsr.toFixed(3)} (no corrected stage)`
							: `ok WER ${v.werAsr.toFixed(3)}→${v.werCorrected.toFixed(3)}`,
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
	).pipe(
		Command.withDescription(
			"Run the manifest's stage selection (transcribe/cleanup/judge) over the persisted cohort.",
		),
	);

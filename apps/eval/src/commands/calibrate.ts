/**
 * calibrate — judge-vs-gold agreement over persisted results (P-076).
 *
 *   eval calibrate <suite> [--workdir d] [--run-id id]
 *
 * Market eval platforms calibrate their judges on labeled corpora;
 * ours measures agreement between the judge's persisted verdicts and
 * the cheap lexical gold (checkEntities text floor) recomputed over
 * the same stage text. Only JUDGE-sourced entity verdicts count —
 * text-floor verdicts are the gold side, never the measured side.
 * Negation entities the floor cannot verify ("unverified") and
 * non-binary judge statuses are excluded from scoring and reported
 * via the questions/coverage counts, not silently bucketed.
 *
 * Output: markdown on stdout, a JSONL record appended to
 * `<workdir>/reports/calibrations.jsonl`, and a CalibrationReport
 * persisted via EvalStorePort for later threshold work.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { Console, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import {
	EvalStorePort,
	renderCalibrationMarkdown,
	wilsonLowerBound,
	type CalibrationBucket,
	type CalibrationJudge,
	type CalibrationKindStat,
	type CalibrationReport,
	type ConfSegment,
} from "@ktb/eval-core";
import {
	bucketByConfidence,
	checkEntities,
	DatasetStorePort,
	type Sample,
	type SampleResult,
} from "@ktb/eval-consultation";

import { storeReportLayers } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { findSuite } from "../suites.ts";
import { datasetVersionOf, userError, workdirFlag } from "../shared.ts";

const optStr = Option.getOrUndefined;

/** One scored judge-vs-gold comparison. */
interface CalibrationPoint {
	readonly kind: string;
	readonly confidence: number | undefined;
	readonly agreed: boolean;
}

/** Judge-sourced entity verdict → binary answer, or undefined when
 * the status is not a definite yes/no (unverified/substituted/…). */
const judgeBool = (status: string): boolean | undefined =>
	status === "correct" ? true : status === "dropped" ? false : undefined;

/** Text-floor verdict → expected binary answer. "unverified" (negation
 * polarity the floor cannot prove) yields undefined — excluded. */
const floorBool = (status: string): boolean | undefined =>
	status === "correct" ? true : status === "dropped" ? false : undefined;

/** Score one result's judge-sourced entity verdicts against the
 * recomputed text floor, per stage. Returns points + coverage counts. */
const scoreResult = (
	sample: Sample,
	result: SampleResult,
): { points: CalibrationPoint[]; unjudged: number; unverifiable: number } => {
	const entities = sample.gold.entities ?? [];
	const points: CalibrationPoint[] = [];
	let unjudged = 0;
	let unverifiable = 0;
	const stages: { text: string; metrics: SampleResult["asrMetrics"] | undefined }[] = [
		{ text: result.asrText, metrics: result.asrMetrics },
		...(result.correctedText !== undefined && result.correctedMetrics !== undefined
			? [{ text: result.correctedText, metrics: result.correctedMetrics }]
			: []),
	];
	for (const { text, metrics } of stages) {
		if (metrics === undefined) continue;
		const floor = checkEntities(entities, text);
		// Match by entity identity, not index — a persisted verdict
		// list could be shorter/longer than today's gold annotations.
		const floorByKey = new Map(floor.map((f) => [`${f.category}${f.entity}`, f.status]));
		metrics.entityVerdicts.forEach((v) => {
			// Only judge-sourced verdicts are the measured side — a
			// text_floor verdict IS the gold and cannot agree with
			// itself.
			if (v.source !== "judge") {
				unjudged++;
				return;
			}
			const j = judgeBool(v.status);
			const f = floorBool(floorByKey.get(`${v.category}${v.entity}`) ?? "");
			if (j === undefined || f === undefined) {
				unverifiable++;
				return;
			}
			points.push({
				kind: "noul", // entity questions are built as noul (pipeline.entityQuestions)
				confidence: v.probability,
				agreed: j === f,
			});
		});
	}
	return { points, unjudged, unverifiable };
};

/** Judge engine/model identities from the run-record JSONL — best
 * effort: a missing/corrupt report file yields an empty list, never
 * a failed calibration (the agreement stats do not depend on it). */
const judgeIdentities = (
	workdir: string,
	runIds: ReadonlySet<string>,
): readonly CalibrationJudge[] => {
	const file = path.join(workdir, "reports", "eval.jsonl");
	if (!fs.existsSync(file)) return [];
	const seen = new Map<string, CalibrationJudge>();
	for (const line of fs.readFileSync(file, "utf8").split("\n")) {
		if (line.trim() === "") continue;
		try {
			const rec = JSON.parse(line) as {
				stage?: string;
				runId?: string;
				engine?: string;
				model?: string;
			};
			if (rec.stage !== "judge" || rec.runId === undefined || !runIds.has(rec.runId)) continue;
			if (rec.engine === undefined) continue;
			const key = `${rec.engine}${rec.model ?? ""}`;
			if (!seen.has(key)) {
				seen.set(key, {
					engine: rec.engine,
					...(rec.model !== undefined ? { model: rec.model } : {}),
				});
			}
		} catch {
			// Tolerate a torn final line — skip, don't fail the report.
		}
	}
	return [...seen.values()];
};

export const makeCalibrateCommand = (ctx: CmdContext) =>
	Command.make(
		"calibrate",
		{
			suite: Argument.String("suite"),
			workdir: Flag.optional(Flag.String("workdir")),
			runId: Flag.optional(Flag.String("run-id")),
		},
		(cfg) =>
			Effect.gen(function* () {
				const suite = yield* Effect.tryPromise({
					try: () => findSuite(ctx.evalsDir, cfg.suite),
					catch: userError,
				});
				const manifest = suite.manifest;
				const workdir = yield* workdirFlag(cfg.workdir);
				const runId = optStr(cfg.runId);
				const { store, evalStore } = storeReportLayers(workdir);
				const datasetVersion = datasetVersionOf(manifest);

				const { samples, results } = yield* Effect.scoped(
					Effect.gen(function* () {
						const s = yield* DatasetStorePort;
						const samples = yield* s.listSamples({ datasetVersion });
						const all = yield* s.listResults(runId !== undefined ? { runId } : undefined);
						return {
							samples,
							results: all.filter((r) => r.datasetVersion === datasetVersion),
						};
					}).pipe(Effect.provide(store)),
				);
				if (results.length === 0) {
					yield* Console.log(
						`no results for dataset "${datasetVersion}" under ${workdir}` +
							(runId !== undefined ? ` (run ${runId})` : "") +
							" — nothing to calibrate",
					);
					return;
				}

				const byId = new Map(samples.map((s) => [s.id, s]));
				const points: CalibrationPoint[] = [];
				const scoredSampleIds = new Set<string>();
				let unjudged = 0;
				let unverifiable = 0;
				let missingSamples = 0;
				for (const result of results) {
					const sample = byId.get(result.sampleId);
					if (sample === undefined) {
						missingSamples++;
						continue;
					}
					const scored = scoreResult(sample, result);
					unjudged += scored.unjudged;
					unverifiable += scored.unverifiable;
					if (scored.points.length > 0) scoredSampleIds.add(result.sampleId);
					points.push(...scored.points);
				}

				const n = points.length;
				const agreements = points.filter((p) => p.agreed).length;
				// Per-kind stats — entity questions are all "noul" today,
				// but the aggregation stays kind-generic.
				const kindNames = [...new Set(points.map((p) => p.kind))].sort();
				const kinds: CalibrationKindStat[] = kindNames.map((kind) => {
					const ks = points.filter((p) => p.kind === kind);
					const kAgree = ks.filter((p) => p.agreed).length;
					return {
						kind,
						n: ks.length,
						agreements: kAgree,
						// kindNames derives from `points`, so ks is never empty.
						agreementRate: kAgree / ks.length,
					};
				});
				// Probability buckets reuse the domain pack's
				// bucketByConfidence (same unscored-bucket convention).
				const segments: ConfSegment[] = points.map((p) => ({
					...(p.confidence !== undefined ? { confidence: p.confidence } : {}),
					correct: p.agreed,
				}));
				const buckets: CalibrationBucket[] = bucketByConfidence(segments).map((b) => ({
					lo: b.lo,
					hi: b.hi,
					count: b.count,
					agreements: b.correct,
					agreementRate: b.precision,
				}));
				const runIds = new Set(results.map((r) => r.runId));
				const report: CalibrationReport = {
					id: `cal-${manifest.id}-${Date.now()}`,
					suiteId: manifest.id,
					dataset: { id: manifest.dataset.id, version: manifest.dataset.version },
					...(runId !== undefined ? { runId } : {}),
					createdAt: Date.now(),
					samples: scoredSampleIds.size,
					questions: n,
					agreements,
					agreementRate: n === 0 ? 0 : agreements / n,
					lowerBound: wilsonLowerBound(agreements, n),
					kinds,
					buckets,
					judges: [...judgeIdentities(workdir, runIds)],
				};

				yield* Console.log(renderCalibrationMarkdown(report));
				if (n === 0) {
					yield* Console.log(
						`coverage: 0 scored question(s) — ${unjudged} verdict(s) lacked a judge ` +
							`answer, ${unverifiable} were unverifiable, ${missingSamples} result(s) ` +
							`had no persisted sample`,
					);
				} else {
					yield* Console.log(
						`coverage: ${n} scored — ${unjudged} unjudged, ${unverifiable} unverifiable, ` +
							`${missingSamples} result(s) without sample`,
					);
				}

				// JSONL record + store persistence — the report is data,
				// both sinks are cheap and serve different consumers
				// (jsonl for ad-hoc analysis, sqlite for queries).
				yield* Effect.try({
					try: () => {
						fs.mkdirSync(path.join(workdir, "reports"), { recursive: true });
						fs.appendFileSync(
							path.join(workdir, "reports", "calibrations.jsonl"),
							`${JSON.stringify(report)}\n`,
						);
					},
					catch: userError,
				});
				yield* Effect.scoped(
					Effect.gen(function* () {
						const s = yield* EvalStorePort;
						yield* s.putCalibrationReport(report).pipe(Effect.mapError(userError));
					}).pipe(Effect.provide(evalStore)),
				);
			}),
	).pipe(Command.withDescription("Judge-vs-gold calibration report over persisted results."));

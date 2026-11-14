/**
 * run.ts — dataset evaluation orchestration: the missing link between
 * eval:generate (manifest rows) and eval-gate (persisted verdicts).
 *
 * For every selected sample: processSample (ASR → cleanup → judge →
 * metrics) → persist SampleResult + all RunRecords → write the
 * sample's status back so a re-run is a real resume, not a repeat.
 *
 * Selection: `statuses` defaults to pending+failed — a re-run retries
 * what failed, it never redoes finished work unless asked. Results
 * key by runId+sampleId, so a resume can't collide with a fresh run.
 */

import * as Effect from "effect/Effect";

import { runBatch, type BatchOptions, type BatchResult } from "./batch.ts";
import { DatasetStorePort, PortError } from "./ports.ts";
import { processSample, recordAll, toSampleResult } from "./pipeline.ts";
import type { Sample } from "./schema.ts";
import type { AsrPort, EvalPort, LlmPort, ReportPort } from "./ports.ts";

export interface RunInput {
	/** One runId per invocation — the cohort key the gate groups by. */
	readonly runId: string;
	/** Store filter — datasetVersion, origin. */
	readonly filter?: {
		readonly origin?: Sample["origin"];
		readonly datasetVersion?: string;
	};
	/** Which sample statuses are eligible. Default: pending + failed —
	 * a re-run resumes unfinished work; pass every status to force a
	 * full re-run. */
	readonly statuses?: readonly NonNullable<Sample["status"]>[];
	/** Cap the cohort size (smoke runs). */
	readonly limit?: number;
	readonly batch?: BatchOptions<PortError>;
}

const DEFAULT_STATUSES: readonly NonNullable<Sample["status"]>[] = ["pending", "failed"];

export const runDataset = (
	input: RunInput,
): Effect.Effect<
	BatchResult<Sample, { readonly sampleId: string }, PortError>,
	PortError,
	AsrPort | LlmPort | EvalPort | DatasetStorePort | ReportPort
> =>
	Effect.gen(function* () {
		const store = yield* DatasetStorePort;
		const eligible = yield* store.listSamples(input.filter);
		const statuses = input.statuses ?? DEFAULT_STATUSES;
		const items = eligible
			.filter((s) => statuses.includes(s.status ?? "pending"))
			.sort((a, b) => a.id.localeCompare(b.id))
			.slice(0, input.limit ?? Number.MAX_SAFE_INTEGER);

		return yield* runBatch({
			items,
			options: input.batch,
			step: (sample) =>
				Effect.gen(function* () {
					if (sample.audio === undefined) {
						return yield* new PortError({
							port: "run",
							message: `sample ${sample.id} has no audio.uri`,
						});
					}
					const run = yield* processSample({ sample, runId: input.runId });
					const result = toSampleResult({ sample, runId: input.runId, run });
					yield* store.putResult(result);
					yield* recordAll(run.records);
					yield* store.putSample({ ...sample, status: "processed" });
					return { sampleId: sample.id };
				}).pipe(
					// Failure isolation is the runner's job — but mark the
					// sample so the next run picks it up as `failed`. The
					// write-back itself may not mask the original error.
					Effect.tapError((e) =>
						Effect.ignore(store.putSample({ ...sample, status: "failed", error: e.message })),
					),
				),
		});
	});

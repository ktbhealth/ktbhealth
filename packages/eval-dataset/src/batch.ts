/**
 * batch.ts — generic resilient batch execution over Effect steps.
 *
 * One mechanism for every pipeline stage: script generation, TTS, ASR,
 * cleanup, judging, persistence. Works over any `Effect<A, E, R>` — the
 * caller decides what a "step" is; the runner owns resilience.
 *
 * Guarantees:
 * - Failure isolation: one item's error/timeout never aborts siblings.
 * - Bounded concurrency via `Effect.forEach { concurrency }`.
 * - Per-attempt retry through caller-supplied `Schedule` (generic —
 *   any policy: exponential, spaced, capped recurs, or none).
 * - Per-attempt timeout; a timed-out attempt is retryable, a timed-out
 *   item surfaces as `status: "timeout"` after the schedule exhausts.
 * - Attempts + latency are tracked for RunRecord/ops reporting.
 * - The runner itself never fails: outcomes carry typed `E` errors.
 */

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { TimeoutError } from "effect/Cause";

export interface BatchOptions<E> {
	/** Max items in flight at once. `1` = sequential. Default: 4. */
	readonly concurrency?: number;
	/** Retry policy applied to each attempt's failure (incl. timeouts).
	 * Default: no retries — a single attempt per item. */
	readonly retry?: Schedule.Schedule<unknown, E | TimeoutError>;
	/** Per-attempt wall-clock limit in ms. Absent = no timeout. */
	readonly timeoutMs?: number;
}

export interface BatchOutcome<I, A, E> {
	readonly item: I;
	readonly index: number;
	readonly status: "ok" | "failed" | "timeout";
	readonly value?: A;
	readonly error?: E;
	readonly attempts: number;
	readonly latencyMs: number;
}

export interface BatchResult<I, A, E> {
	readonly outcomes: readonly BatchOutcome<I, A, E>[];
	readonly ok: readonly A[];
	readonly failed: readonly I[];
	readonly latencyMs: number;
}

const DEFAULT_CONCURRENCY = 4;

export const runBatch = <I, A, E, R>(input: {
	readonly items: readonly I[];
	readonly step: (item: I, index: number) => Effect.Effect<A, E, R>;
	readonly options?: BatchOptions<E>;
}): Effect.Effect<BatchResult<I, A, E>, never, R> =>
	Effect.gen(function* () {
		const started = yield* Effect.sync(() => Date.now());
		const concurrency = input.options?.concurrency ?? DEFAULT_CONCURRENCY;
		const timeoutMs = input.options?.timeoutMs;

		const outcomes = yield* Effect.forEach(
			input.items,
			(item, index) =>
				Effect.gen(function* () {
					const itemStart = yield* Effect.sync(() => Date.now());
					let attempts = 0;

					const attempt = Effect.gen(function* () {
						attempts++;
						return yield* input.step(item, index);
					});

					const guarded: Effect.Effect<A, E | TimeoutError, R> =
						timeoutMs === undefined
							? attempt
							: attempt.pipe(Effect.timeout(Duration.millis(timeoutMs)));

					const settled = yield* Effect.result(
						input.options?.retry !== undefined
							? guarded.pipe(Effect.retry({ schedule: input.options.retry }))
							: guarded,
					);

					const latencyMs = Date.now() - itemStart;
					const base = { item, index, attempts, latencyMs } as const;
					if (settled._tag === "Success") {
						return { ...base, status: "ok" as const, value: settled.success };
					}
					const err = settled.failure;
					return err instanceof TimeoutError
						? ({ ...base, status: "timeout" as const } satisfies BatchOutcome<I, A, E>)
						: ({
								...base,
								status: "failed" as const,
								error: err as E,
							} satisfies BatchOutcome<I, A, E>);
				}),
			{ concurrency },
		);

		return {
			outcomes,
			ok: outcomes.flatMap((o) => (o.status === "ok" ? [o.value as A] : [])),
			failed: outcomes.flatMap((o) => (o.status === "ok" ? [] : [o.item])),
			latencyMs: Date.now() - started,
		};
	});

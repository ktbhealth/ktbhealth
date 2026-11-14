/**
 * eval.ts — EvalPort over a Jev service (`/v1/systemone`) (M2).
 *
 * The decision model receives {state, questions} and must return
 * bounded typed answers with calibrated probabilities — Schema-decoded
 * at the edge; malformed verdicts are typed PortErrors, never silent.
 * Injectable fetch; timeout + caller retry Schedule.
 */

import { Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schedule from "effect/Schedule";

import { EvalAnswer, EvalPort, fnvHex, PortError } from "@ktb/eval-dataset";

export interface JevEvalOptions {
	readonly baseUrl: string;
	readonly fetchImpl?: typeof fetch;
	readonly timeoutMs?: number;
	readonly retry?: Schedule.Schedule<unknown, PortError>;
}

const Answers = Schema.Struct({ answers: Schema.Array(EvalAnswer) });
const decode = Schema.decodeUnknownSync(Answers);

const fail = (message: string) => new PortError({ port: "eval", message });

export const makeJevEval = (opts: JevEvalOptions): Layer.Layer<EvalPort> =>
	Layer.succeed(
		EvalPort,
		EvalPort.of({
			judge: (input) => {
				const fetchImpl = opts.fetchImpl ?? fetch;
				const timeoutMs = opts.timeoutMs ?? 30_000;
				const started = Date.now();
				// Content hash, not a count — two judge calls with the same
				// number of questions but different text must not share a
				// run identity.
				const qhash = fnvHex(JSON.stringify(input.questions));

				const request = Effect.tryPromise({
					try: async () => {
						const res = await fetchImpl(`${opts.baseUrl}/v1/systemone`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ state: input.state, questions: input.questions }),
						});
						if (!res.ok) {
							throw new Error(`jev ${res.status}: ${await res.text()}`);
						}
						return res.json() as Promise<unknown>;
					},
					catch: (e) => fail(e instanceof Error ? e.message : String(e)),
				});

				const guarded = request.pipe(
					Effect.timeout(`${timeoutMs} millis`),
					Effect.mapError((e) =>
						e instanceof PortError ? e : fail(`timeout after ${timeoutMs}ms`),
					),
					Effect.flatMap((body) =>
						Effect.try({
							try: () => decode(body),
							catch: (e) => fail(`malformed verdicts: ${String(e).slice(0, 200)}`),
						}),
					),
				);

				return (
					opts.retry !== undefined ? guarded.pipe(Effect.retry({ schedule: opts.retry })) : guarded
				).pipe(
					Effect.map(({ answers }) => ({
						answers,
						record: {
							runId: "eval",
							taskId: `judge:${qhash}`,
							stage: "judge",
							engine: "jev",
							inputHash: `q${qhash}`,
							startedAt: started,
							latencyMs: Date.now() - started,
						},
					})),
				);
			},
		}),
	);

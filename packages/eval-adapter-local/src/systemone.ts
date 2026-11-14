/**
 * systemone.ts — EvalPort over a self-hosted System One decision
 * server (`POST /v1/systemone`, TypeSafe wire shape) (M2).
 *
 * Speaks the same request/response contract as TypeSafe's hosted
 * System One API — object-keyed questions, per-question typed
 * answers with calibrated probabilities — so an open local model
 * can stand in as the eval judge:
 *
 *   pip install "openjev-ai[serve]"
 *   wev serve --model alanhuangya/OpenJev-4B --port 8009
 *   EVAL_SYSTEMONE_URL=http://127.0.0.1:8009 eval run <suite> --profile local-systemone
 *
 * The same wire format is served by razorback16/openjev (vLLM/MLX)
 * and amithgc/local-jev, so any of them works as `baseUrl`.
 *
 * Wire translation (EvalQuestion → TypeSafe question):
 *   noul   → { type: "noul",   instructions: text }
 *   choice → { type: "choice", instructions: text,
 *              criteria: { <option>: null, … } }
 *   score  → { type: "score",  instructions: text,
 *              criteria: ["0".."maxScore"] } — level labels are the
 *              rubric; `maxScore` absent defaults to a 0–3 rubric.
 *
 * Answers come back keyed by question id with per-kind payloads:
 *   noul   { type, noul: p(yes) }            → value = p ≥ 0.5,
 *          probability = p(yes) when true else p(no) = 1−p — the
 *          reported probability always backs the CHOSEN verdict
 *   choice { type, choice, probabilities }  → value = choice,
 *          probability = probabilities[choice]
 *   score  { type, score, confidence?, probabilities? }
 *                                          → value = score,
 *          probability = confidence ?? max(probabilities)
 * Malformed/missing verdicts are typed PortErrors, never silent —
 * including probabilities outside [0, 1].
 *
 * `model` is required by the TypeSafe request schema but opaque to
 * self-hosted servers — OpenJev's pydantic model defaults it to
 * "wev-latest" and ignores the value. Default here is "wev-latest";
 * set `model`/EVAL_SYSTEMONE_MODEL when pointing at a hosted
 * TypeSafe endpoint that validates model names.
 *
 * LICENSE NOTE: `wev-ai`/`openjev-ai` and the OpenJev-4B weights are
 * Apache-2.0 per the Hugging Face model card — verify the license of
 * any specific model revision before redistributing weights or using
 * them in a production pipeline.
 */

import { Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schedule from "effect/Schedule";

import {
	EvalPort,
	PortError,
	type EvalAnswer,
	type EvalQuestion,
	type RunRecord,
} from "@ktb/eval-core";
import { fnvHex } from "@ktb/eval-consultation";

import { isLoopbackUrl } from "./asr.ts";

export interface SystemOneEvalOptions {
	readonly baseUrl: string;
	/** Model name sent in the request body. Opaque to self-hosted
	 * servers (OpenJev ignores it); required by hosted TypeSafe.
	 * Default "wev-latest" — OpenJev's own server-side default. */
	readonly model?: string;
	readonly fetchImpl?: typeof fetch;
	readonly timeoutMs?: number;
	readonly retry?: Schedule.Schedule<unknown, PortError>;
	/** PHI egress declaration — judge state is scrubbed upstream, but
	 * the capability is declared honestly: default auto-derived from
	 * baseUrl (loopback = local-only), override for remote-but-trusted
	 * deployments. */
	readonly egress?: boolean;
}

/** Score questions without `maxScore` get this rubric (0..DEFAULT_MAX_SCORE). */
const DEFAULT_MAX_SCORE = 3;

const fail = (message: string) => new PortError({ port: "eval", message });

// ---------- request translation ----------

type WireQuestion =
	| { readonly type: "noul"; readonly instructions: string }
	| {
			readonly type: "choice";
			readonly instructions: string;
			readonly criteria: Record<string, null>;
	  }
	| {
			readonly type: "score";
			readonly instructions: string;
			readonly criteria: readonly string[];
	  };

const toWireQuestion = (q: EvalQuestion): WireQuestion => {
	switch (q.kind) {
		case "noul":
			return { type: "noul", instructions: q.text };
		case "choice":
			// Option names become criteria keys; null descriptions mean
			// "interpreted by name alone" per the TypeSafe schema.
			return {
				type: "choice",
				instructions: q.text,
				criteria: Object.fromEntries((q.options ?? []).map((o) => [o, null])),
			};
		case "score": {
			const levels = Math.max(2, Math.floor(q.maxScore ?? DEFAULT_MAX_SCORE) + 1);
			return {
				type: "score",
				instructions: q.text,
				criteria: Array.from({ length: levels }, (_, i) => String(i)),
			};
		}
	}
};

// ---------- response decode ----------

const Probabilities = Schema.Record(Schema.String, Schema.Number);

/** Loose per-answer shape — the discriminated union lives in
 * `toEvalAnswer`, which validates the fields each kind actually
 * needs (a `choice` answer without `probabilities[choice]` is
 * malformed even if it parses). */
const WireAnswer = Schema.Struct({
	type: Schema.String,
	noul: Schema.optionalKey(Schema.Number),
	choice: Schema.optionalKey(Schema.String),
	score: Schema.optionalKey(Schema.Number),
	probabilities: Schema.optionalKey(Probabilities),
	confidence: Schema.optionalKey(Schema.Number),
});
type WireAnswer = typeof WireAnswer.Type;

const SystemOneResponse = Schema.Struct({
	answers: Schema.Record(Schema.String, WireAnswer),
});
const decode = Schema.decodeUnknownSync(SystemOneResponse);

/** A probability outside [0, 1] is a malformed verdict, not a
 * calibration quirk — reject it like any other decode failure. */
const prob = (p: number, what: string): number => {
	if (!Number.isFinite(p) || p < 0 || p > 1) {
		throw new Error(`${what} probability out of [0, 1]: ${p}`);
	}
	return p;
};

/** Validate every value of a probabilities map (when present). */
const checkProbs = (probs: Record<string, number> | undefined, what: string): void => {
	if (probs === undefined) return;
	for (const [k, v] of Object.entries(probs)) prob(v, `${what}.probabilities["${k}"]`);
};

/** Map one wire answer back to the EvalAnswer contract. Throws
 * Error with a precise reason — the caller wraps it as a PortError. */
const toEvalAnswer = (q: EvalQuestion, a: WireAnswer | undefined): EvalAnswer => {
	if (a === undefined) {
		throw new Error(`missing answer for question "${q.id}"`);
	}
	if (a.type !== q.kind) {
		throw new Error(`answer "${q.id}" type "${a.type}" != question kind "${q.kind}"`);
	}
	switch (q.kind) {
		case "noul": {
			// `noul` IS p(yes) — the value collapses it to a verdict.
			if (a.noul === undefined) {
				throw new Error(`noul answer "${q.id}" lacks the "noul" probability`);
			}
			const pYes = prob(a.noul, `noul answer "${q.id}"`);
			const yes = pYes >= 0.5;
			// probability backs the CHOSEN answer: p(yes) on a yes
			// verdict, p(no) = 1−p(yes) on a no verdict — a stored
			// 0.1 beside value:false would read as "10% sure it's no"
			// when the model was 90% sure.
			return { id: q.id, kind: "noul", value: yes, probability: yes ? pYes : 1 - pYes };
		}
		case "choice": {
			if (a.choice === undefined) {
				throw new Error(`choice answer "${q.id}" lacks "choice"`);
			}
			checkProbs(a.probabilities, `choice answer "${q.id}"`);
			const p = a.probabilities?.[a.choice];
			if (p === undefined) {
				throw new Error(`choice answer "${q.id}" lacks probabilities["${a.choice}"]`);
			}
			return {
				id: q.id,
				kind: "choice",
				value: a.choice,
				probability: prob(p, `choice answer "${q.id}"`),
			};
		}
		case "score": {
			if (a.score === undefined) {
				throw new Error(`score answer "${q.id}" lacks "score"`);
			}
			checkProbs(a.probabilities, `score answer "${q.id}"`);
			if (a.confidence !== undefined) prob(a.confidence, `score answer "${q.id}".confidence`);
			// `score` is the probability-weighted level; the honest
			// scalar certainty is `confidence`, falling back to the
			// modal level's probability when a server omits it.
			const probs = a.probabilities === undefined ? [] : Object.values(a.probabilities);
			const modal = probs.length > 0 ? Math.max(...probs) : undefined;
			const probability = a.confidence ?? modal;
			if (probability === undefined) {
				throw new Error(`score answer "${q.id}" lacks confidence/probabilities`);
			}
			return { id: q.id, kind: "score", value: a.score, probability };
		}
	}
};

// ---------- port ----------

export const makeSystemOneEval = (opts: SystemOneEvalOptions): Layer.Layer<EvalPort> =>
	Layer.succeed(
		EvalPort,
		EvalPort.of({
			egress: opts.egress ?? !isLoopbackUrl(opts.baseUrl),
			judge: (input) => {
				const fetchImpl = opts.fetchImpl ?? fetch;
				const timeoutMs = opts.timeoutMs ?? 30_000;
				const model = opts.model ?? "wev-latest";
				const started = Date.now();
				// Content hash, not a count — same rule as makeJevEval.
				const qhash = fnvHex(JSON.stringify(input.questions));

				const request = Effect.tryPromise({
					try: async () => {
						const res = await fetchImpl(`${opts.baseUrl}/v1/systemone`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							// Abort the socket at the same deadline as the
							// Effect.timeout below — a hung service must not
							// leak the request.
							signal: AbortSignal.timeout(timeoutMs),
							body: JSON.stringify({
								model,
								state: input.state,
								questions: Object.fromEntries(
									input.questions.map((q) => [q.id, toWireQuestion(q)]),
								),
							}),
						});
						if (!res.ok) {
							throw new Error(`systemone ${res.status}: ${await res.text()}`);
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
							try: () => {
								const { answers } = decode(body);
								return input.questions.map((q) => toEvalAnswer(q, answers[q.id]));
							},
							catch: (e) => fail(`malformed systemone verdicts: ${String(e).slice(0, 240)}`),
						}),
					),
				);

				return (
					opts.retry !== undefined ? guarded.pipe(Effect.retry({ schedule: opts.retry })) : guarded
				).pipe(
					Effect.map((answers) => ({
						answers,
						record: {
							runId: "eval",
							taskId: `judge:${qhash}`,
							stage: "judge",
							engine: "systemone",
							model,
							inputHash: `q${qhash}`,
							startedAt: started,
							latencyMs: Date.now() - started,
						} satisfies RunRecord,
					})),
				);
			},
		}),
	);

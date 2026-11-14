import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { EvalPort, PortError, type EvalQuestion } from "@ktb/eval-core";

import { makeSystemOneEval } from "./systemone.ts";

const questions: EvalQuestion[] = [
	{ id: "q1", kind: "noul", text: "present?" },
	{
		id: "q2",
		kind: "choice",
		text: "class?",
		options: ["justified_fix", "harmful"],
	},
	{ id: "q3", kind: "score", text: "rate?", maxScore: 4 },
];

const wireAnswers = {
	model: "wev-latest",
	answers: {
		q1: { type: "noul", noul: 0.97 },
		q2: {
			type: "choice",
			choice: "justified_fix",
			confidence: 0.8,
			probabilities: { justified_fix: 0.8, harmful: 0.2 },
		},
		q3: {
			type: "score",
			score: 2.5,
			confidence: 0.6,
			probabilities: { "0": 0.1, "1": 0.2, "2": 0.4, "3": 0.2, "4": 0.1 },
		},
	},
};

const okFetch = (body: unknown = wireAnswers, status = 200) =>
	(() =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		)) as typeof fetch;

const run = (
	fetchImpl: typeof fetch,
	opts: Partial<Parameters<typeof makeSystemOneEval>[0]> = {},
	qs: readonly EvalQuestion[] = questions,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const evalp = yield* EvalPort;
			return yield* evalp.judge({ state: { text: "x" }, questions: qs });
		}).pipe(
			Effect.provide(makeSystemOneEval({ baseUrl: "http://localhost:9", fetchImpl, ...opts })),
		),
	);

const runErr = async (
	fetchImpl: typeof fetch,
	opts: Partial<Parameters<typeof makeSystemOneEval>[0]> = {},
	qs: readonly EvalQuestion[] = questions,
) =>
	run(fetchImpl, opts, qs).then(
		() => null,
		(e) => e,
	);

describe("makeSystemOneEval", () => {
	it("maps typed answers + record", async () => {
		const r = await run(okFetch());
		expect(r.answers).toEqual([
			{ id: "q1", kind: "noul", value: true, probability: 0.97 },
			{ id: "q2", kind: "choice", value: "justified_fix", probability: 0.8 },
			{ id: "q3", kind: "score", value: 2.5, probability: 0.6 },
		]);
		expect(r.record.engine).toBe("systemone");
		expect(r.record.model).toBe("wev-latest");
		expect(r.record.stage).toBe("judge");
		expect(r.record.inputHash).toMatch(/^q[0-9a-f]{8}$/);
		expect(r.record.taskId).toBe(`judge:${r.record.inputHash.slice(1)}`);
	});

	it("posts the TypeSafe shape: model + object-keyed questions", async () => {
		let url = "";
		let body = "";
		const spy = (async (u: unknown, init: RequestInit) => {
			url = String(u);
			body = typeof init.body === "string" ? init.body : "";
			return new Response(JSON.stringify(wireAnswers));
		}) as typeof fetch;
		await run(spy);
		expect(url).toBe("http://localhost:9/v1/systemone");
		const parsed = JSON.parse(body);
		expect(parsed.model).toBe("wev-latest");
		expect(parsed.state).toEqual({ text: "x" });
		expect(parsed.questions.q1).toEqual({ type: "noul", instructions: "present?" });
		expect(parsed.questions.q2).toEqual({
			type: "choice",
			instructions: "class?",
			criteria: { justified_fix: null, harmful: null },
		});
		expect(parsed.questions.q3).toEqual({
			type: "score",
			instructions: "rate?",
			criteria: ["0", "1", "2", "3", "4"],
		});
	});

	it("honors the model option in body and record", async () => {
		let body = "";
		const spy = (async (_u: unknown, init: RequestInit) => {
			body = typeof init.body === "string" ? init.body : "";
			return new Response(JSON.stringify(wireAnswers));
		}) as typeof fetch;
		const r = await run(spy, { model: "openjev-8b" });
		expect(JSON.parse(body).model).toBe("openjev-8b");
		expect(r.record.model).toBe("openjev-8b");
	});

	it("translates degenerate questions: no options, no maxScore", async () => {
		let body = "";
		const spy = (async (_u: unknown, init: RequestInit) => {
			body = typeof init.body === "string" ? init.body : "";
			return new Response(
				JSON.stringify({
					answers: {
						c: {
							type: "choice",
							choice: "x",
							probabilities: { x: 1 },
						},
						s: { type: "score", score: 1, confidence: 0.5 },
					},
				}),
			);
		}) as typeof fetch;
		const qs: EvalQuestion[] = [
			{ id: "c", kind: "choice", text: "pick?" },
			{ id: "s", kind: "score", text: "rate?" },
		];
		await run(spy, {}, qs);
		const parsed = JSON.parse(body);
		expect(parsed.questions.c.criteria).toEqual({});
		expect(parsed.questions.s.criteria).toEqual(["0", "1", "2", "3"]);
	});

	it("noul p < 0.5 collapses to false", async () => {
		const r = await run(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.1 },
					q2: {
						type: "choice",
						choice: "harmful",
						probabilities: { justified_fix: 0.3, harmful: 0.7 },
					},
					q3: { type: "score", score: 0.4, confidence: 0.9 },
				},
			}),
		);
		expect(r.answers[0]).toEqual({ id: "q1", kind: "noul", value: false, probability: 0.1 });
		expect(r.answers[1]?.value).toBe("harmful");
		expect(r.answers[1]?.probability).toBe(0.7);
	});

	it("score falls back to the modal level probability without confidence", async () => {
		const r = await run(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.9 },
					q2: {
						type: "choice",
						choice: "justified_fix",
						probabilities: { justified_fix: 0.6, harmful: 0.4 },
					},
					q3: {
						type: "score",
						score: 3.1,
						probabilities: { "0": 0.1, "1": 0.2, "2": 0.3, "3": 0.3, "4": 0.1 },
					},
				},
			}),
		);
		expect(r.answers[2]?.probability).toBe(0.3);
	});

	it("score with confidence and no probabilities uses confidence", async () => {
		const r = await run(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.9 },
					q2: {
						type: "choice",
						choice: "justified_fix",
						probabilities: { justified_fix: 0.6, harmful: 0.4 },
					},
					q3: { type: "score", score: 1, confidence: 0.42 },
				},
			}),
		);
		expect(r.answers[2]?.probability).toBe(0.42);
	});

	it("surfaces service failure as PortError", async () => {
		const err = await runErr(okFetch({ e: "x" }, 500));
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("500");
	});

	it("rejects a body that fails the response schema", async () => {
		const err = await runErr(okFetch({ answers: [] }));
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("malformed");
	});

	it("rejects a missing answer", async () => {
		const err = await runErr(
			okFetch({
				answers: {
					q2: {
						type: "choice",
						choice: "justified_fix",
						probabilities: { justified_fix: 1 },
					},
				},
			}),
			{},
			[{ id: "q9", kind: "noul", text: "?" }],
		);
		expect(err.message).toContain('missing answer for question "q9"');
	});

	it("rejects an answer type that disagrees with the question kind", async () => {
		const err = await runErr(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.9 },
					q2: { type: "noul", noul: 0.5 },
					q3: { type: "score", score: 1, confidence: 0.5 },
				},
			}),
		);
		expect(err.message).toContain('answer "q2" type "noul" != question kind "choice"');
	});

	it("rejects a noul answer without the probability", async () => {
		const err = await runErr(
			okFetch({
				answers: {
					q1: { type: "noul" },
					q2: {
						type: "choice",
						choice: "justified_fix",
						probabilities: { justified_fix: 1 },
					},
					q3: { type: "score", score: 1, confidence: 0.5 },
				},
			}),
		);
		expect(err.message).toContain('noul answer "q1" lacks the "noul" probability');
	});

	it("rejects a choice answer without choice", async () => {
		const err = await runErr(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.9 },
					q2: { type: "choice", probabilities: { justified_fix: 1 } },
					q3: { type: "score", score: 1, confidence: 0.5 },
				},
			}),
		);
		expect(err.message).toContain('choice answer "q2" lacks "choice"');
	});

	it("rejects a choice answer without probabilities for the pick", async () => {
		// probabilities absent entirely.
		const noProbs = await runErr(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.9 },
					q2: { type: "choice", choice: "justified_fix" },
					q3: { type: "score", score: 1, confidence: 0.5 },
				},
			}),
		);
		expect(noProbs.message).toContain('lacks probabilities["justified_fix"]');
		// probabilities present but missing the selected key.
		const wrongKey = await runErr(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.9 },
					q2: {
						type: "choice",
						choice: "justified_fix",
						probabilities: { other: 1 },
					},
					q3: { type: "score", score: 1, confidence: 0.5 },
				},
			}),
		);
		expect(wrongKey.message).toContain('lacks probabilities["justified_fix"]');
	});

	it("rejects a score answer without score", async () => {
		const err = await runErr(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.9 },
					q2: {
						type: "choice",
						choice: "justified_fix",
						probabilities: { justified_fix: 1 },
					},
					q3: { type: "score", confidence: 0.5 },
				},
			}),
		);
		expect(err.message).toContain('score answer "q3" lacks "score"');
	});

	it("rejects a score answer with no certainty signal", async () => {
		const err = await runErr(
			okFetch({
				answers: {
					q1: { type: "noul", noul: 0.9 },
					q2: {
						type: "choice",
						choice: "justified_fix",
						probabilities: { justified_fix: 1 },
					},
					q3: { type: "score", score: 2, probabilities: {} },
				},
			}),
		);
		expect(err.message).toContain('score answer "q3" lacks confidence/probabilities');
	});

	it("times out a hanging judge", async () => {
		const slow = (() => new Promise<Response>((r) => setTimeout(r, 5_000))) as typeof fetch;
		const err = await runErr(slow, { timeoutMs: 30 });
		expect(err.message).toContain("timeout");
	});

	it("maps non-Error fetch failures to PortError", async () => {
		const throwing = (() => Promise.reject("net down")) as unknown as typeof fetch;
		const err = await runErr(throwing);
		expect(err.message).toContain("net down");
	});

	it("retries on the caller schedule", async () => {
		let calls = 0;
		const flaky = (async () => {
			calls++;
			if (calls === 1) throw new Error("refused");
			return new Response(JSON.stringify(wireAnswers));
		}) as typeof fetch;
		const r = await run(flaky, { retry: Schedule.recurs(1) });
		expect(r.answers).toHaveLength(3);
		expect(calls).toBe(2);
	});

	it("defaults to the global fetch + timeout when options are absent", async () => {
		// No fetchImpl: real fetch against localhost:9 refuses fast —
		// covers `?? fetch` and `?? 30_000` without a wait.
		const err = await Effect.runPromise(
			Effect.gen(function* () {
				const evalp = yield* EvalPort;
				return yield* evalp.judge({ state: { text: "x" }, questions });
			}).pipe(Effect.provide(makeSystemOneEval({ baseUrl: "http://localhost:9" }))),
		).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
	});
});

describe("egress declaration", () => {
	const flag = (baseUrl: string, egress?: boolean) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const evalp = yield* EvalPort;
				return evalp.egress;
			}).pipe(
				Effect.provide(
					makeSystemOneEval({
						baseUrl,
						fetchImpl: okFetch(),
						...(egress !== undefined ? { egress } : {}),
					}),
				),
			),
		);

	it("auto-derives from baseUrl and honors the override", async () => {
		expect(await flag("http://localhost:9")).toBe(false);
		expect(await flag("http://127.0.0.1:8009")).toBe(false);
		expect(await flag("https://judge.remote.example.com")).toBe(true);
		expect(await flag("https://judge.remote.example.com", false)).toBe(false);
	});
});

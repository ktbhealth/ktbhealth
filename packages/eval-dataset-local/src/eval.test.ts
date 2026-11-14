import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { EvalPort, PortError } from "@ktb/eval-dataset";

import { makeJevEval } from "./eval.ts";

const answers = {
	answers: [
		{ id: "q1", kind: "noul", value: true, probability: 0.97 },
		{ id: "q2", kind: "choice", value: "justified_fix", probability: 0.8 },
	],
};

const questions = [
	{ id: "q1", kind: "noul" as const, text: "present?" },
	{ id: "q2", kind: "choice" as const, text: "class?", options: ["justified_fix", "harmful"] },
];

const okFetch = (body: unknown = answers, status = 200) =>
	(() =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		)) as typeof fetch;

const run = (fetchImpl: typeof fetch, opts: Partial<Parameters<typeof makeJevEval>[0]> = {}) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const evalp = yield* EvalPort;
			return yield* evalp.judge({ state: { text: "x" }, questions });
		}).pipe(Effect.provide(makeJevEval({ baseUrl: "http://localhost:9", fetchImpl, ...opts }))),
	);

describe("makeJevEval", () => {
	it("maps typed answers + record", async () => {
		const r = await run(okFetch());
		expect(r.answers).toHaveLength(2);
		expect(r.answers[1]?.value).toBe("justified_fix");
		expect(r.record.engine).toBe("jev");
	});

	it("posts to /v1/systemone with state+questions", async () => {
		let url = "";
		let body = "";
		const spy = (async (u: unknown, init: RequestInit) => {
			url = String(u);
			body = String(init.body);
			return new Response(JSON.stringify(answers));
		}) as typeof fetch;
		await run(spy);
		expect(url).toBe("http://localhost:9/v1/systemone");
		expect(JSON.parse(body).questions).toHaveLength(2);
	});

	it("surfaces service failure as PortError", async () => {
		const err = await run(okFetch({ e: "x" }, 500)).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("500");
	});

	it("rejects malformed verdicts", async () => {
		const err = await run(okFetch({ answers: [{ id: 1 }] })).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("malformed");
	});

	it("times out a hanging judge", async () => {
		const slow = (() => new Promise<Response>((r) => setTimeout(r, 5_000))) as typeof fetch;
		const err = await run(slow, { timeoutMs: 30 }).then(
			() => null,
			(e) => e,
		);
		expect(err.message).toContain("timeout");
	});

	it("maps non-Error fetch failures to PortError", async () => {
		const throwing = (() => Promise.reject("net down")) as unknown as typeof fetch;
		const err = await run(throwing).then(
			() => null,
			(e) => e,
		);
		expect(err.message).toContain("net down");
	});

	it("retries on the caller schedule", async () => {
		let calls = 0;
		const flaky = (async () => {
			calls++;
			if (calls === 1) throw new Error("refused");
			return new Response(JSON.stringify(answers));
		}) as typeof fetch;
		const r = await run(flaky, { retry: Schedule.recurs(1) });
		expect(r.answers).toHaveLength(2);
		expect(calls).toBe(2);
	});

	it("defaults to the global fetch + timeout when options are absent", async () => {
		// No fetchImpl: real fetch against localhost:9 refuses fast —
		// covers `?? fetch` and `?? 30_000` without a wait.
		const err = await Effect.runPromise(
			Effect.gen(function* () {
				const evalp = yield* EvalPort;
				return yield* evalp.judge({ state: { text: "x" }, questions });
			}).pipe(Effect.provide(makeJevEval({ baseUrl: "http://localhost:9" }))),
		).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
	});
});

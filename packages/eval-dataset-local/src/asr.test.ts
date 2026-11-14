import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { AsrPort, PortError } from "@ktb/eval-dataset";

import { makeLocalAsr } from "./asr.ts";

const asrBody = {
	text: "o paciente nega febre",
	language: "pt",
	segments: [{ t0: 0, t1: 1, text: "o paciente nega febre", confidence: 0.9 }],
};

const okFetch = (body: unknown = asrBody, status = 200) =>
	(() =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		)) as typeof fetch;

const run = (
	fetchImpl: typeof fetch,
	opts: Partial<Parameters<typeof makeLocalAsr>[0]> = {},
	uri = "file:///tmp/x.wav",
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const asr = yield* AsrPort;
			return yield* asr.transcribe({ uri });
		}).pipe(Effect.provide(makeLocalAsr({ baseUrl: "http://localhost:8765", fetchImpl, ...opts }))),
	);

describe("makeLocalAsr", () => {
	it("maps a healthy response to AsrResult + record", async () => {
		const r = await run(okFetch());
		expect(r.asr.text).toContain("nega febre");
		expect(r.asr.segments[0]?.confidence).toBe(0.9);
		expect(r.record.engine).toBe("faster-whisper");
		expect(r.record.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("strips the file:// scheme into the audio_path payload", async () => {
		let body = "";
		const spy = (async (_u: unknown, init: RequestInit) => {
			body = String(init.body);
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		await run(spy);
		expect(JSON.parse(body).audio_path).toBe("/tmp/x.wav");
		expect(JSON.parse(body).language).toBe("pt");
	});

	it("surfaces a service failure as typed PortError", async () => {
		const err = await run(okFetch({ error: "down" }, 503)).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("503");
	});

	it("rejects malformed response bodies as PortError", async () => {
		const err = await run(okFetch({ not: "a transcript" })).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("malformed");
	});

	it("times out a hanging service", async () => {
		const slow = (() => new Promise<Response>((r) => setTimeout(r, 5_000))) as typeof fetch;
		const err = await run(slow, { timeoutMs: 40 }).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("timeout");
	});

	it("does not retry permanent 4xx failures", async () => {
		let calls = 0;
		const bad = (async () => {
			calls++;
			return new Response("audio not found", { status: 400 });
		}) as typeof fetch;
		const err = await run(bad, { retry: Schedule.recurs(3) }).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(calls).toBe(1);
	});

	it("retries 5xx failures on the caller's schedule", async () => {
		let calls = 0;
		const flaky = (async () => {
			calls++;
			if (calls < 3) return new Response("boom", { status: 500 });
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		const r = await run(flaky, { retry: Schedule.recurs(3) });
		expect(r.asr.text).toContain("nega febre");
		expect(calls).toBe(3);
	});

	it("does not retry malformed response bodies", async () => {
		let calls = 0;
		const bad = (async () => {
			calls++;
			return new Response(JSON.stringify({ not: "a transcript" }));
		}) as typeof fetch;
		const err = await run(bad, { retry: Schedule.recurs(3) }).then(
			() => null,
			(e) => e,
		);
		expect(err.message).toContain("malformed");
		expect(calls).toBe(1);
	});

	it("does not retry invalid JSON bodies", async () => {
		let calls = 0;
		const bad = (async () => {
			calls++;
			return new Response("<<<not json>>>", {
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;
		const err = await run(bad, { retry: Schedule.recurs(3) }).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(calls).toBe(1);
	});

	it("retries timeouts on the caller's schedule", async () => {
		let calls = 0;
		const slowOnce = (async () => {
			calls++;
			if (calls === 1) return new Promise<Response>(() => {});
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		const r = await run(slowOnce, { timeoutMs: 30, retry: Schedule.recurs(1) });
		expect(r.asr.text).toContain("nega febre");
		expect(calls).toBe(2);
	});

	it("truncates long error bodies in the PortError message", async () => {
		const big = "x".repeat(2000);
		const err = await run(okFetch({ error: big }, 500)).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("500");
		expect(err.message.length).toBeLessThan(400);
	});

	it("tolerates a trailing slash on baseUrl", async () => {
		let url = "";
		const spy = (async (u: unknown) => {
			url = String(u);
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		await run(spy, { baseUrl: "http://localhost:8765/" });
		expect(url).toBe("http://localhost:8765/transcribe");
	});

	it("percent-decodes file:// paths", async () => {
		let body = "";
		const spy = (async (_u: unknown, init: RequestInit) => {
			body = String(init.body);
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		await run(spy, {}, "file:///tmp/my%20file.wav");
		expect(JSON.parse(body).audio_path).toBe("/tmp/my file.wav");
	});

	it("falls back to the raw path on malformed percent escapes", async () => {
		let body = "";
		const spy = (async (_u: unknown, init: RequestInit) => {
			body = String(init.body);
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		await run(spy, {}, "file:///tmp/%E0%A4%A");
		expect(JSON.parse(body).audio_path).toBe("/tmp/%E0%A4%A");
	});

	it("passes an AbortSignal so timeouts abort the request", async () => {
		let signal: AbortSignal | null | undefined;
		const spy = (async (_u: unknown, init: RequestInit) => {
			signal = init.signal;
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		await run(spy, { timeoutMs: 5_000 });
		expect(signal).toBeInstanceOf(AbortSignal);
	});

	it("retries transient failures on the caller's schedule", async () => {
		let calls = 0;
		const flaky = (async () => {
			calls++;
			if (calls === 1) throw new Error("conn refused");
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		const r = await run(flaky, { retry: Schedule.recurs(2) });
		expect(r.asr.text).toContain("nega febre");
		expect(calls).toBe(2);
	});

	it("uses the global fetch when none is injected", async () => {
		// No fetchImpl — real fetch against an unreachable port → typed error.
		const layer = makeLocalAsr({ baseUrl: "http://localhost:1" });
		const err = await Effect.runPromise(
			Effect.result(
				Effect.gen(function* () {
					const asr = yield* AsrPort;
					return yield* asr.transcribe({ uri: "file:///tmp/x.wav" });
				}).pipe(Effect.provide(layer)),
			),
		);
		expect(err._tag).toBe("Failure");
	});

	it("survives non-Error throws from the transport", async () => {
		const weird = (async () => {
			throw "raw rejection";
		}) as unknown as typeof fetch;
		const err = await run(weird).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
	});

	it("does not retry when no schedule is given", async () => {
		let calls = 0;
		const dead = (async () => {
			calls++;
			throw new Error("conn refused");
		}) as typeof fetch;
		const err = await run(dead).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(calls).toBe(1);
	});

	it("passes a non-default language through", async () => {
		let body = "";
		const spy = (async (_u: unknown, init: RequestInit) => {
			body = String(init.body);
			return new Response(JSON.stringify(asrBody));
		}) as typeof fetch;
		const layer = makeLocalAsr({ baseUrl: "http://localhost:1", fetchImpl: spy });
		await Effect.runPromise(
			Effect.gen(function* () {
				const asr = yield* AsrPort;
				return yield* asr.transcribe({ uri: "stub://a" }, { language: "en" });
			}).pipe(Effect.provide(layer)),
		);
		expect(JSON.parse(body).language).toBe("en");
		expect(JSON.parse(body).audio_path).toBe("stub://a");
	});
});

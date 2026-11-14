import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { AsrPort, PortError } from "@ktb/eval-dataset";

import { makeWorkersAiAsr } from "./asr.ts";

const audio = { uri: "r2://blobs/a1.wav" };
const bytes = new Uint8Array([82, 73, 70, 70]);

const readAudio = () => Effect.succeed(bytes);

const okBody = {
	success: true,
	result: {
		text: "refere cefaleia",
		segments: [{ start: 0, end: 1.2, text: "refere cefaleia" }],
	},
};

const fetchJson = (body: unknown, init?: { status?: number }) =>
	((_url: string, _init?: RequestInit) =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status: init?.status ?? 200,
				headers: { "Content-Type": "application/json" },
			}),
		)) as unknown as typeof fetch;

const transcribe = (
	fetchImpl: typeof fetch,
	opts: Partial<Parameters<typeof makeWorkersAiAsr>[0]> = {},
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const asr = yield* AsrPort;
			return yield* asr.transcribe(audio, { language: "pt" });
		}).pipe(
			Effect.provide(
				makeWorkersAiAsr({
					accountId: "acc-1",
					apiToken: "tok",
					model: "@cf/openai/whisper",
					readAudio,
					fetchImpl,
					...opts,
				}),
			),
		),
	);

describe("workers-ai asr adapter", () => {
	it("posts audio bytes and maps result to AsrResult", async () => {
		let seenUrl = "";
		let seenInit: RequestInit | undefined;
		const spy = ((url: string, init?: RequestInit) => {
			seenUrl = url;
			seenInit = init;
			return Promise.resolve(new Response(JSON.stringify(okBody)));
		}) as unknown as typeof fetch;
		const out = await transcribe(spy);
		expect(seenUrl).toBe(
			"https://api.cloudflare.com/client/v4/accounts/acc-1/ai/run/@cf/openai/whisper",
		);
		expect((seenInit?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
		expect(out.asr.text).toBe("refere cefaleia");
		expect(out.asr.segments).toEqual([{ t0: 0, t1: 1.2, text: "refere cefaleia" }]);
		expect(out.asr.language).toBe("pt");
		expect(out.record.engine).toBe("workers-ai:@cf/openai/whisper");
	});

	it("handles responses without segments", async () => {
		const out = await transcribe(fetchJson({ success: true, result: { text: "ok" } }));
		expect(out.asr.segments).toEqual([]);
	});

	it("uses a custom endpoint when provided", async () => {
		let seenUrl = "";
		const spy = ((url: string) => {
			seenUrl = url;
			return Promise.resolve(new Response(JSON.stringify(okBody)));
		}) as unknown as typeof fetch;
		await transcribe(spy, { endpoint: "http://localhost:9" });
		expect(seenUrl).toContain("http://localhost:9/client/v4/");
	});

	it("fails typed on success=false", async () => {
		await expect(transcribe(fetchJson({ success: false, result: { text: "" } }))).rejects.toThrow(
			/success=false/,
		);
	});

	it("fails typed on http error", async () => {
		await expect(transcribe(fetchJson({}, { status: 502 }))).rejects.toThrow(/workers-ai 502/);
	});

	it("fails typed on malformed payload", async () => {
		await expect(transcribe(fetchJson({ result: "nope" }))).rejects.toThrow(/malformed/);
	});

	it("fails typed on timeout", async () => {
		const hanging = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
		await expect(transcribe(hanging, { timeoutMs: 10 })).rejects.toThrow(/timeout after 10ms/);
	});

	it("retries when a schedule is provided", async () => {
		let calls = 0;
		const flaky = (() => {
			calls += 1;
			return calls < 2
				? Promise.resolve(new Response("boom", { status: 500 }))
				: Promise.resolve(new Response(JSON.stringify(okBody)));
		}) as unknown as typeof fetch;
		const out = await transcribe(flaky, { retry: Schedule.recurs(2) });
		expect(calls).toBe(2);
		expect(out.asr.text).toBe("refere cefaleia");
	});

	it("propagates readAudio failures as the call's error", async () => {
		const failRead = () => Effect.fail(new PortError({ port: "store", message: "missing blob" }));
		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					const asr = yield* AsrPort;
					return yield* asr.transcribe(audio);
				}).pipe(
					Effect.provide(
						makeWorkersAiAsr({
							accountId: "a",
							apiToken: "t",
							model: "m",
							readAudio: failRead,
							fetchImpl: fetchJson(okBody),
						}),
					),
				),
			),
		).rejects.toThrow(/missing blob/);
	});

	it("defaults to the global fetch when fetchImpl is absent", async () => {
		// Point at an unroutable local endpoint — real fetch fails fast.
		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					const asr = yield* AsrPort;
					return yield* asr.transcribe(audio);
				}).pipe(
					Effect.provide(
						makeWorkersAiAsr({
							accountId: "a",
							apiToken: "t",
							model: "m",
							readAudio,
							endpoint: "http://localhost:1",
						}),
					),
				),
			),
		).rejects.toThrow();
	});

	it("maps non-Error fetch throws to PortError", async () => {
		const throwing = (() => Promise.reject("net down")) as unknown as typeof fetch;
		await expect(transcribe(throwing)).rejects.toThrow(/net down/);
	});
});

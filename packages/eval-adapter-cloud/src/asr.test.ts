import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { PortError, type BlobMeta } from "@ktb/eval-core";
import { AsrPort } from "@ktb/eval-consult";

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
	callOpts?: {
		language?: string;
		origin?: "synthetic" | "real_anonymized";
		blobMeta?: BlobMeta | null;
	},
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const asr = yield* AsrPort;
			return yield* asr.transcribe(audio, callOpts ?? { language: "pt" });
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
		expect((seenInit?.headers as Record<string, string> | undefined)?.Authorization).toBe(
			"Bearer tok",
		);
		expect(out.asr.text).toBe("refere cefaleia");
		expect(out.asr.segments).toEqual([{ t0: 0, t1: 1.2, text: "refere cefaleia" }]);
		expect(out.asr.language).toBe("pt");
		expect(out.record.engine).toBe("workers-ai:@cf/openai/whisper");
		expect(out.record.model).toBe("@cf/openai/whisper");
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
			/workers-ai returned success=false$/,
		);
	});

	it("surfaces provider errors[]/messages[] on success=false", async () => {
		const body = {
			success: false,
			errors: [{ code: 10000, message: "rate limited" }],
			messages: ["slow down", ""],
		};
		await expect(transcribe(fetchJson(body))).rejects.toThrow(
			/workers-ai returned success=false: .*rate limited.*slow down/,
		);
	});

	it("fails typed when success=true carries no result", async () => {
		await expect(transcribe(fetchJson({ success: true }))).rejects.toThrow(
			/malformed response: success=true without result/,
		);
	});

	it("refuses declared real_anonymized audio before any fetch", async () => {
		let calls = 0;
		const spy = (() => {
			calls += 1;
			return Promise.resolve(new Response(JSON.stringify(okBody)));
		}) as unknown as typeof fetch;
		await expect(transcribe(spy, {}, { origin: "real_anonymized" })).rejects.toThrow(
			/refusing real_anonymized audio/,
		);
		expect(calls).toBe(0);
	});

	it("allows real_anonymized audio only with allowRealAudio", async () => {
		const out = await transcribe(
			fetchJson(okBody),
			{ allowRealAudio: true },
			{
				origin: "real_anonymized",
			},
		);
		expect(out.asr.text).toBe("refere cefaleia");
	});

	it("passes synthetic origin through to the provider call", async () => {
		const out = await transcribe(fetchJson(okBody), {}, { origin: "synthetic" });
		expect(out.asr.text).toBe("refere cefaleia");
	});

	it("refuses audio whose stored provenance is real_anonymized", async () => {
		let calls = 0;
		const spy = (() => {
			calls += 1;
			return Promise.resolve(new Response(JSON.stringify(okBody)));
		}) as unknown as typeof fetch;
		// Declared synthetic cannot launder a real consult recording —
		// the stored blob meta wins.
		await expect(
			transcribe(spy, {}, { origin: "synthetic", blobMeta: { origin: "real_anonymized" } }),
		).rejects.toThrow(/stored provenance "real_anonymized"/);
		expect(calls).toBe(0);
	});

	it("refuses audio whose stored provenance is unknown", async () => {
		let calls = 0;
		const spy = (() => {
			calls += 1;
			return Promise.resolve(new Response(JSON.stringify(okBody)));
		}) as unknown as typeof fetch;
		await expect(transcribe(spy, {}, { blobMeta: { origin: "unknown" } })).rejects.toThrow(
			/stored provenance "unknown"/,
		);
		expect(calls).toBe(0);
	});

	it("allows verified-synthetic stored provenance", async () => {
		const out = await transcribe(fetchJson(okBody), {}, { blobMeta: { origin: "synthetic" } });
		expect(out.asr.text).toBe("refere cefaleia");
	});

	it("allows null blobMeta — no store record is the documented bypass", async () => {
		const out = await transcribe(fetchJson(okBody), {}, { blobMeta: null });
		expect(out.asr.text).toBe("refere cefaleia");
	});

	it("allowRealAudio overrides a stored-provenance refusal", async () => {
		const out = await transcribe(
			fetchJson(okBody),
			{ allowRealAudio: true },
			{ blobMeta: { origin: "real_anonymized" } },
		);
		expect(out.asr.text).toBe("refere cefaleia");
	});

	it("readBlobMeta lookup enforces stored provenance for direct callers", async () => {
		let calls = 0;
		const spy = (() => {
			calls += 1;
			return Promise.resolve(new Response(JSON.stringify(okBody)));
		}) as unknown as typeof fetch;
		await expect(
			transcribe(spy, { readBlobMeta: () => Effect.succeed({ origin: "real_anonymized" }) }),
		).rejects.toThrow(/stored provenance "real_anonymized"/);
		expect(calls).toBe(0);
	});

	it("readBlobMeta synthetic and null lookups allow the call", async () => {
		const syn = await transcribe(fetchJson(okBody), {
			readBlobMeta: () => Effect.succeed({ origin: "synthetic" }),
		});
		expect(syn.asr.text).toBe("refere cefaleia");
		const none = await transcribe(fetchJson(okBody), {
			readBlobMeta: () => Effect.succeed(null),
		});
		expect(none.asr.text).toBe("refere cefaleia");
	});

	it("explicit callOpts.blobMeta wins over readBlobMeta", async () => {
		let looked = 0;
		const out = await transcribe(
			fetchJson(okBody),
			{
				readBlobMeta: () => {
					looked += 1;
					return Effect.succeed<BlobMeta | null>({ origin: "real_anonymized" });
				},
			},
			{ blobMeta: { origin: "synthetic" } },
		);
		expect(out.asr.text).toBe("refere cefaleia");
		expect(looked).toBe(0);
	});

	it("readBlobMeta failures propagate as PortError — fail closed", async () => {
		await expect(
			transcribe(fetchJson(okBody), {
				readBlobMeta: () =>
					Effect.fail(new PortError({ port: "store", message: "meta store down" })),
			}),
		).rejects.toThrow(/meta store down/);
	});

	it("skips the provenance lookup entirely for declared real_anonymized", async () => {
		let looked = 0;
		await expect(
			transcribe(
				fetchJson(okBody),
				{
					readBlobMeta: () => {
						looked += 1;
						return Effect.succeed<BlobMeta | null>({ origin: "synthetic" });
					},
				},
				{ origin: "real_anonymized" },
			),
		).rejects.toThrow(/refusing real_anonymized audio/);
		expect(looked).toBe(0);
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
		).rejects.toThrow(/fetch failed|ECONNREFUSED|network/i);
	});

	it("maps non-Error fetch throws to PortError", async () => {
		const throwing = (() => Promise.reject("net down")) as unknown as typeof fetch;
		await expect(transcribe(throwing)).rejects.toThrow(/net down/);
	});
});

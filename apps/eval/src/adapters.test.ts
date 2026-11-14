import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, test } from "vitest";

import { EvalPort, ReportPort } from "@ktb/eval-core";
import {
	AsrPort,
	DatasetStorePort,
	LlmPort,
	TtsPort,
	type AcousticProfile,
	type EvalQuestion,
	type Sample,
	type TaskEnvelope,
} from "@ktb/eval-consult";
import { CANNED_ASR, CANNED_EDITS, CANNED_SCRIPT } from "@ktb/eval-adapter-stub";

import {
	capabilityLayer,
	makeHttpAcpTransport,
	makeReadAudioFile,
	modelLayers,
	storeReportLayers,
	stubAsrLayer,
	stubEvalLayer,
	stubLlmLayer,
	stubTtsLayer,
	type WireContext,
} from "./adapters.ts";

const ctx = (over: Partial<WireContext> = {}): WireContext => ({
	workdir: fs.mkdtempSync(path.join(os.tmpdir(), "eval-wire-")),
	profile: "stub",
	env: {},
	...over,
});

const acoustic: AcousticProfile = {
	ttsModel: "stub",
	voiceId: "br_male_1",
	noise: "clean",
	sampleRate: 16000,
};

const envelope: TaskEnvelope = {
	taskId: "t1",
	role: "generator",
	input: "say hi",
	outputSchema: "Text",
};

describe("stub port layers", () => {
	test("TtsPort synthesizes a stub audio ref", async () => {
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const tts = yield* TtsPort;
				return yield* tts.synthesize({ script: "oi", voiceId: "v1", acoustic });
			}).pipe(Effect.provide(stubTtsLayer)),
		);
		expect(out.audio.uri).toBe("stub://tts/v1");
		expect(out.record.stage).toBe("synthesize");
		expect(out.record.engine).toBe("stub-tts");
	});

	test("AsrPort returns the canned transcript", async () => {
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const asr = yield* AsrPort;
				return yield* asr.transcribe({ uri: "stub://a" });
			}).pipe(Effect.provide(stubAsrLayer)),
		);
		expect(out.asr).toBe(CANNED_ASR);
		expect(out.record.stage).toBe("transcribe");
	});

	test("LlmPort generate/correct return canned payloads", async () => {
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* LlmPort;
				const g = yield* llm.generate(envelope);
				const c = yield* llm.correct({ ...envelope, outputSchema: "EditList" });
				return { g, c };
			}).pipe(Effect.provide(stubLlmLayer)),
		);
		expect(out.g.text).toBe(CANNED_SCRIPT);
		expect(out.g.record.stage).toBe("script_gen");
		expect(out.c.edits).toBe(CANNED_EDITS);
		expect(out.c.record.stage).toBe("cleanup");
	});

	test("EvalPort answers every question kind", async () => {
		const questions: EvalQuestion[] = [
			{ id: "n", kind: "noul", text: "t" },
			{ id: "c", kind: "choice", text: "t", options: ["a", "b"] },
			{ id: "c2", kind: "choice", text: "t" },
			{ id: "s", kind: "score", text: "t" },
		];
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const ev = yield* EvalPort;
				return yield* ev.judge({ state: {}, questions });
			}).pipe(Effect.provide(stubEvalLayer)),
		);
		expect(out.answers).toEqual([
			{ id: "n", kind: "noul", value: true, probability: 0.95 },
			{ id: "c", kind: "choice", value: "a", probability: 0.95 },
			{ id: "c2", kind: "choice", value: "", probability: 0.95 },
			{ id: "s", kind: "score", value: 0, probability: 0.95 },
		]);
		expect(out.record.stage).toBe("judge");
	});
});

describe("capabilityLayer selection", () => {
	test("stub keys return working layers", async () => {
		const layer = capabilityLayer(ctx(), "asr", "stub") as Layer.Layer<AsrPort>;
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const asr = yield* AsrPort;
				return yield* asr.transcribe({ uri: "x" });
			}).pipe(Effect.provide(layer)),
		);
		expect(out.asr.text).toContain("cabeca");
	});

	test("unknown capability and unknown adapter key throw", () => {
		expect(() => capabilityLayer(ctx(), "ghost", "stub")).toThrow(/no adapter implementation/);
		expect(() => capabilityLayer(ctx(), "tts", "bogus")).toThrow(/no adapter implementation/);
		expect(() => capabilityLayer(ctx(), "asr", "bogus")).toThrow(/no adapter implementation/);
		expect(() => capabilityLayer(ctx(), "llm", "bogus")).toThrow(/no adapter implementation/);
		expect(() => capabilityLayer(ctx(), "eval", "bogus")).toThrow(/no adapter implementation/);
	});

	test("non-stub adapters require their env vars", () => {
		expect(() => capabilityLayer(ctx({ profile: "local" }), "llm", "acp")).toThrow(/EVAL_ACP_URL/);
		expect(() => capabilityLayer(ctx({ profile: "local" }), "eval", "jev")).toThrow(/EVAL_JEV_URL/);
		expect(() => capabilityLayer(ctx({ profile: "local-systemone" }), "eval", "systemone")).toThrow(
			/EVAL_SYSTEMONE_URL/,
		);
		expect(() => capabilityLayer(ctx({ profile: "cloud" }), "asr", "workers-ai")).toThrow(
			/EVAL_CF_ACCOUNT_ID/,
		);
	});

	test("faster-whisper builds with default and configured endpoints", () => {
		expect(() => capabilityLayer(ctx({ profile: "local" }), "asr", "faster-whisper")).not.toThrow();
		expect(() =>
			capabilityLayer(
				ctx({ profile: "local", env: { EVAL_ASR_URL: "http://asr" }, fetchImpl: fetch }),
				"asr",
				"faster-whisper",
			),
		).not.toThrow();
		// edge-tts constructs the same way (needs no env).
		expect(() => capabilityLayer(ctx({ profile: "local" }), "tts", "edge-tts")).not.toThrow();
	});

	test("configured adapters build layers", () => {
		// Construction only — the services need live endpoints to run.
		expect(() =>
			capabilityLayer(ctx({ env: { EVAL_ACP_URL: "http://x" } }), "llm", "acp"),
		).not.toThrow();
		expect(() =>
			capabilityLayer(ctx({ env: { EVAL_ACP_URL: "http://x" }, fetchImpl: fetch }), "llm", "acp"),
		).not.toThrow();
		expect(() =>
			capabilityLayer(ctx({ env: { EVAL_JEV_URL: "http://j" } }), "eval", "jev"),
		).not.toThrow();
		expect(() =>
			capabilityLayer(ctx({ env: { EVAL_JEV_URL: "http://x" }, fetchImpl: fetch }), "eval", "jev"),
		).not.toThrow();
		expect(() =>
			capabilityLayer(ctx({ env: { EVAL_SYSTEMONE_URL: "http://s" } }), "eval", "systemone"),
		).not.toThrow();
		expect(() =>
			capabilityLayer(
				ctx({
					env: { EVAL_SYSTEMONE_URL: "http://s", EVAL_SYSTEMONE_MODEL: "m" },
					fetchImpl: fetch,
				}),
				"eval",
				"systemone",
			),
		).not.toThrow();
		// Empty-string model counts as unset.
		expect(() =>
			capabilityLayer(
				ctx({ env: { EVAL_SYSTEMONE_URL: "http://s", EVAL_SYSTEMONE_MODEL: "" } }),
				"eval",
				"systemone",
			),
		).not.toThrow();
		expect(() =>
			capabilityLayer(
				ctx({
					profile: "cloud",
					env: {
						EVAL_CF_ACCOUNT_ID: "a",
						EVAL_CF_API_TOKEN: "t",
						EVAL_ASR_MODEL: "m",
						EVAL_CF_API_ENDPOINT: "http://ep",
					},
					fetchImpl: fetch,
				}),
				"asr",
				"workers-ai",
			),
		).not.toThrow();
		// No fetchImpl → the adapter falls back to global fetch.
		expect(() =>
			capabilityLayer(
				ctx({
					profile: "cloud",
					env: {
						EVAL_CF_ACCOUNT_ID: "a",
						EVAL_CF_API_TOKEN: "t",
						EVAL_ASR_MODEL: "m",
					},
				}),
				"asr",
				"workers-ai",
			),
		).not.toThrow();
		// Empty-string endpoint counts as unset.
		expect(() =>
			capabilityLayer(
				ctx({
					profile: "cloud",
					env: {
						EVAL_CF_ACCOUNT_ID: "a",
						EVAL_CF_API_TOKEN: "t",
						EVAL_ASR_MODEL: "m",
						EVAL_CF_API_ENDPOINT: "",
					},
					fetchImpl: fetch,
				}),
				"asr",
				"workers-ai",
			),
		).not.toThrow();
		// Empty-string env counts as missing.
		expect(() => capabilityLayer(ctx({ env: { EVAL_ACP_URL: "" } }), "llm", "acp")).toThrow(
			/EVAL_ACP_URL/,
		);
	});
});

describe("modelLayers", () => {
	test("builds one layer per needed capability", () => {
		const layers = modelLayers(ctx(), { asr: "stub", llm: "stub", eval: "stub" }, [
			"asr",
			"llm",
			"eval",
		]);
		expect(layers).toHaveLength(3);
	});

	test("missing adapter in the map is an error", () => {
		expect(() => modelLayers(ctx(), {}, ["asr"])).toThrow(/no adapter under profile/);
	});
});

describe("storeReportLayers", () => {
	test("provides a working store+report pair", async () => {
		const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-sr-"));
		const { store, report } = storeReportLayers(workdir);
		const sample: Sample = {
			id: "s1",
			datasetVersion: "dv",
			origin: "synthetic" as const,
			script: "Doctor: oi? Patient: dor.",
			scriptHash: "h",
			persona: { region: "r", ageBand: "a", register: "f", specialty: "s" },
			gold: { validatedBy: "generator" },
		};
		await Effect.runPromise(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				yield* s.putSample(sample);
				const back = yield* s.getSample("s1");
				expect(back?.id).toBe("s1");
				const r = yield* ReportPort;
				yield* r.append({
					runId: "r1",
					taskId: "t",
					stage: "transcribe",
					engine: "e",
					inputHash: "h",
					startedAt: 0,
				});
				const md = yield* r.render("r1");
				expect(md).toContain("transcribe");
			}).pipe(Effect.provide(Layer.mergeAll(store, report))),
		);
		fs.rmSync(workdir, { recursive: true, force: true });
	});
});

describe("workers-ai adapter wiring", () => {
	const cloudCtx = (): WireContext =>
		ctx({
			profile: "cloud",
			env: {
				EVAL_CF_ACCOUNT_ID: "acct",
				EVAL_CF_API_TOKEN: "tok",
				EVAL_ASR_MODEL: "@cf/test/asr",
			},
			fetchImpl: (async () =>
				new Response(
					JSON.stringify({
						success: true,
						result: { text: "oi", segments: [{ start: 0, end: 1, text: "oi" }] },
					}),
					{ status: 200 },
				)) as typeof fetch,
		});

	test("transcribes a file:// audio ref end-to-end", async () => {
		const c = cloudCtx();
		// Legit eval audio lives under the run workdir (TTS output,
		// dataset blobs) — the reader is confined to it.
		const audioFile = path.join(c.workdir, "tts", "audio", "a.wav");
		fs.mkdirSync(path.dirname(audioFile), { recursive: true });
		fs.writeFileSync(audioFile, new Uint8Array([1, 2, 3]));
		const layer = capabilityLayer(c, "asr", "workers-ai") as Layer.Layer<AsrPort>;
		const out = await Effect.runPromise(
			Effect.gen(function* () {
				const asr = yield* AsrPort;
				return yield* asr.transcribe({ uri: `file://${audioFile}` });
			}).pipe(Effect.provide(layer)),
		);
		expect(out.asr.text).toBe("oi");
		expect(out.asr.segments[0]?.t0).toBe(0);
	});

	test("file:// audio outside the workdir is a typed PortError", async () => {
		const outside = path.join(os.tmpdir(), `eval-outside-${Date.now()}.wav`);
		fs.writeFileSync(outside, new Uint8Array([1, 2, 3]));
		const c = cloudCtx();
		const layer = capabilityLayer(c, "asr", "workers-ai") as Layer.Layer<AsrPort>;
		try {
			const exit = await Effect.runPromise(
				Effect.gen(function* () {
					const asr = yield* AsrPort;
					return yield* asr.transcribe({ uri: `file://${outside}` });
				}).pipe(Effect.exit, Effect.provide(layer)),
			);
			expect(exit._tag).toBe("Failure");
		} finally {
			fs.rmSync(outside, { force: true });
		}
	});

	test("non-file audio uri is a typed PortError", async () => {
		const layer = capabilityLayer(cloudCtx(), "asr", "workers-ai") as Layer.Layer<AsrPort>;
		const exit = await Effect.runPromise(
			Effect.gen(function* () {
				const asr = yield* AsrPort;
				return yield* asr.transcribe({ uri: "stub://nope" });
			}).pipe(Effect.exit, Effect.provide(layer)),
		);
		expect(exit._tag).toBe("Failure");
	});
});

describe("makeReadAudioFile", () => {
	const read = (workdir: string, uri: string) =>
		Effect.runPromise(Effect.exit(makeReadAudioFile(workdir)(uri)));

	test("reads files under the workdir, rejects escapes", async () => {
		const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-ra-"));
		fs.mkdirSync(path.join(workdir, "blobs"), { recursive: true });
		const inside = path.join(workdir, "blobs", "a.wav");
		fs.writeFileSync(inside, new Uint8Array([9, 9]));
		const outside = path.join(os.tmpdir(), `eval-ra-out-${Date.now()}.wav`);
		fs.writeFileSync(outside, new Uint8Array([8]));
		try {
			const ok = await read(workdir, `file://${inside}`);
			expect(ok._tag).toBe("Success");

			// `..` escape and absolute outside paths are refused.
			for (const uri of [
				`file://${workdir}/../escape.wav`,
				`file://${outside}`,
				"stub://nope",
				// Malformed percent-escape — decode falls back to raw.
				"file://%zz",
				// The workdir itself resolves inside the boundary but
				// is a directory — still a typed read error.
				`file://${workdir}`,
			]) {
				const exit = await read(workdir, uri);
				expect(exit._tag).toBe("Failure");
			}
			// A missing file inside the workdir is still a typed error.
			const missing = await read(workdir, `file://${workdir}/nope.wav`);
			expect(missing._tag).toBe("Failure");
		} finally {
			fs.rmSync(workdir, { recursive: true, force: true });
			fs.rmSync(outside, { force: true });
		}
	});
});

describe("makeHttpAcpTransport", () => {
	const request = {
		jsonrpc: "2.0" as const,
		id: "t1",
		method: "task.submit" as const,
		params: { envelope },
	};

	test("returns the decoded response body", async () => {
		const calls: string[] = [];
		const fakeFetch: typeof fetch = async (url, init) => {
			calls.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
			expect(init?.method).toBe("POST");
			return new Response(JSON.stringify({ jsonrpc: "2.0", id: "t1", result: { payload: "hi" } }), {
				status: 200,
			});
		};
		const transport = makeHttpAcpTransport("http://acp.local/", fakeFetch);
		const out = await Effect.runPromise(transport(request));
		expect(calls).toEqual(["http://acp.local"]);
		expect(out).toEqual({ jsonrpc: "2.0", id: "t1", result: { payload: "hi" } });
	});

	test("non-2xx is a typed PortError", async () => {
		const fakeFetch: typeof fetch = async () => new Response("nope", { status: 500 });
		const transport = makeHttpAcpTransport("http://acp", fakeFetch);
		const exit = await Effect.runPromise(Effect.exit(transport(request)));
		expect(exit._tag).toBe("Failure");
	});

	test("transport throw is a typed PortError", async () => {
		const fakeFetch: typeof fetch = async () => {
			throw new Error("conn refused");
		};
		const transport = makeHttpAcpTransport("http://acp", fakeFetch);
		const exit = await Effect.runPromise(Effect.exit(transport(request)));
		expect(exit._tag).toBe("Failure");
	});
});

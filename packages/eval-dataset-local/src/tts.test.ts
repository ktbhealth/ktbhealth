import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { PortError, TtsPort } from "@ktb/eval-dataset";

import { defaultRun, ffmpegDegradeArgs, makeLocalTts, type CliRunner } from "./tts.ts";

const profile = (noise: "clean" | "clinic" | "phone_bandpass" | "far_mic" = "clean") => ({
	ttsModel: "edge",
	voiceId: "br_male_1",
	noise,
	sampleRate: 16000,
});

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tts-test-"));

/** Fake CLI executor: creates the artifact a real binary would,
 * records every command, and can fail N times first. */
const fakeRun = (calls: string[], failFirst = 0, hangMs = 0): CliRunner => {
	let failed = 0;
	return (cmd) =>
		Effect.gen(function* () {
			calls.push(cmd.join(" "));
			if (hangMs > 0) {
				yield* Effect.sleep(`${hangMs} millis`);
			}
			if (failed++ < failFirst) {
				return yield* Effect.fail(new PortError({ port: "tts", message: "transient" }));
			}
			if (cmd[0] === "edge-tts") {
				fs.writeFileSync(cmd[cmd.length - 1]!, "mp3");
			}
			if (cmd[0] === "ffmpeg") {
				fs.writeFileSync(cmd[cmd.length - 1]!, Buffer.from("RIFF" + "x".repeat(40)));
			}
		});
};

const synth = (opts: {
	run?: CliRunner;
	voice?: string;
	noise?: "clean" | "clinic" | "phone_bandpass" | "far_mic";
	workDir?: string;
	maxConcurrent?: number;
	retry?: Schedule.Schedule<unknown, PortError>;
}) => {
	const layer = makeLocalTts({
		workDir: opts.workDir ?? dir(),
		voiceMap: {},
		run: opts.run,
		maxConcurrent: opts.maxConcurrent,
		retry: opts.retry,
	});
	return Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const tts = yield* TtsPort;
				return yield* tts.synthesize({
					script: "o paciente toma losartana",
					voiceId: opts.voice ?? "br_male_1",
					acoustic: profile(opts.noise),
				});
			}).pipe(Effect.provide(layer)),
		),
	);
};

describe("ffmpegDegradeArgs", () => {
	it("clean profile is a single -af resample pass", () => {
		const args = ffmpegDegradeArgs("in.mp3", "out.wav", profile("clean"));
		expect(args).toContain("aresample=16000");
		expect(args.join(" ")).not.toContain("anoisesrc");
	});

	it("phone_bandpass applies band filters + noise mix in one invocation", () => {
		const args = ffmpegDegradeArgs("in.mp3", "out.wav", profile("phone_bandpass")).join(" ");
		expect(args).toContain("anoisesrc");
		expect(args).toContain("highpass=f=300");
		expect(args).toContain("lowpass=f=3400");
	});

	it("far_mic attenuates and lowpasses; clinic adds background noise", () => {
		expect(ffmpegDegradeArgs("i", "o", profile("far_mic")).join(" ")).toContain("volume=0.7");
		expect(ffmpegDegradeArgs("i", "o", profile("clinic")).join(" ")).toContain("anoisesrc");
	});
});

describe("makeLocalTts", () => {
	it("synthesizes: voice map → edge-tts → ffmpeg → file:// audio + record", async () => {
		const calls: string[] = [];
		const r = await synth({ run: fakeRun(calls) });
		expect(calls[0]).toContain("edge-tts");
		expect(calls[0]).toContain("pt-BR-AntonioNeural"); // alias resolved inside the adapter
		expect(calls[1]).toContain("ffmpeg");
		expect(r.audio.uri.startsWith("file://")).toBe(true);
		expect(r.audio.size).toBeGreaterThan(0);
		expect(r.record.engine).toBe("edge-tts");
	});

	it("fails typed on an unknown voice alias — provider never reached", async () => {
		const calls: string[] = [];
		const err = await synth({ run: fakeRun(calls), voice: "nope" }).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("unknown voice alias");
		expect(calls).toHaveLength(0);
	});

	it("retries transient edge-tts failures with backoff", async () => {
		const calls: string[] = [];
		const r = await synth({ run: fakeRun(calls, 2) });
		expect(r.audio.uri).toContain("file://");
		expect(calls.filter((c) => c.includes("edge-tts"))).toHaveLength(3);
	});

	it("surfaces PortError after the retry schedule exhausts", async () => {
		const calls: string[] = [];
		const err = await synth({ run: fakeRun(calls, 9) }).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("transient");
		// default: 1 initial + upTo(3) retries = 4 edge-tts attempts
		expect(calls.filter((c) => c.includes("edge-tts"))).toHaveLength(4);
	});

	it("honors a caller-supplied retry policy — recurs(0) means no retries", async () => {
		const calls: string[] = [];
		const err = await synth({ run: fakeRun(calls, 9), retry: Schedule.recurs(0) }).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(calls.filter((c) => c.includes("edge-tts"))).toHaveLength(1);
	});

	it("fails typed when ffmpeg fails", async () => {
		const calls: string[] = [];
		const run: CliRunner = (cmd) =>
			Effect.gen(function* () {
				calls.push(cmd.join(" "));
				if (cmd[0] === "edge-tts") {
					fs.writeFileSync(cmd[cmd.length - 1]!, "mp3");
					return;
				}
				return yield* Effect.fail(new PortError({ port: "tts", message: "ffmpeg gone" }));
			});
		const workDir = dir();
		const err = await synth({ run, workDir }).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		// temp mp3 removed even on ffmpeg failure
		expect(
			fs.readdirSync(path.join(workDir, "audio")).filter((f) => f.endsWith(".mp3")),
		).toHaveLength(0);
	});

	it("default runner executes real processes and surfaces exit failures", async () => {
		// `true`/`false` are always present on POSIX — exercises the real
		// execFile path without edge-tts/ffmpeg.
		await Effect.runPromise(defaultRun(["true"]));
		const fail = await Effect.runPromise(Effect.result(defaultRun(["false"])));
		expect(fail._tag).toBe("Failure");
		const missing = await Effect.runPromise(
			Effect.result(defaultRun(["definitely-not-a-binary-xyz"])),
		);
		expect(missing._tag).toBe("Failure");

		// Layer built without `run` uses the real executor — edge-tts is
		// not on PATH in CI/dev → typed PortError, no retries.
		const err = await synth({
			run: undefined,
			retry: Schedule.recurs(0),
			workDir: dir(),
		}).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
	});

	it("caps concurrent syntheses via the semaphore", async () => {
		let inFlight = 0;
		let max = 0;
		const run: CliRunner = (cmd) =>
			Effect.gen(function* () {
				inFlight++;
				max = Math.max(max, inFlight);
				yield* Effect.sleep("40 millis");
				inFlight--;
				if (cmd[0] === "edge-tts") fs.writeFileSync(cmd[cmd.length - 1]!, "mp3");
				if (cmd[0] === "ffmpeg") fs.writeFileSync(cmd[cmd.length - 1]!, "wavdata");
			});
		const layer = makeLocalTts({ workDir: dir(), voiceMap: {}, run, maxConcurrent: 1 });
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const tts = yield* TtsPort;
					yield* Effect.all(
						[0, 1, 2].map((i) =>
							tts.synthesize({ script: `s${i}`, voiceId: "br_male_1", acoustic: profile() }),
						),
						{ concurrency: 3 },
					);
				}).pipe(Effect.provide(layer)),
			),
		);
		expect(max).toBe(1);
	});
});

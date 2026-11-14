/**
 * tts.ts — local TtsPort backed by the edge-tts CLI + ffmpeg (T-100).
 *
 * Side effects (documented): this is a LOCAL adapter with a NETWORK
 * call — edge-tts speaks to a hosted TTS endpoint, no credentials
 * needed. ffmpeg is fully local. Audio lands under `workDir/audio/`;
 * intermediate files are removed per attempt.
 *
 * Provider details stay at the edge: the domain passes an abstract
 * `voiceId` alias (e.g. "br_male_1"); `voiceMap` resolves it to the
 * engine's voice name here. Engine literals never reach the domain.
 *
 * Resilience: edge-tts is transient-flaky (~20% in the benchmark) —
 * synthesis retries on a Schedule (default: exponential ∩ 3 recurs)
 * and runs under a Semaphore cap (default 2) to avoid rate limiting.
 * ffmpeg degradation is a single invocation per profile.
 */

import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";

import type { AcousticProfile, NoiseProfile } from "@ktb/eval-dataset";
import { PortError, TtsPort } from "@ktb/eval-dataset";

export type CliRunner = (cmd: readonly string[]) => Effect.Effect<void, PortError>;

export interface LocalTtsOptions {
	/** Where audio + intermediates land. Created if absent. */
	readonly workDir: string;
	/** Domain voice alias → engine voice name. Unknown alias → PortError. */
	readonly voiceMap: Readonly<Record<string, string>>;
	/** Command executor — injectable for tests; default spawns processes. */
	readonly run?: CliRunner;
	/** Max in-flight edge-tts calls. Default 2. */
	readonly maxConcurrent?: number;
	/** Retry policy for transient synth failures. Default: exp ∩ recurs(3). */
	readonly retry?: Schedule.Schedule<unknown, PortError>;
}

const DEFAULT_VOICES: Record<string, string> = {
	br_male_1: "pt-BR-AntonioNeural",
	br_female_1: "pt-BR-FranciscaNeural",
};

/** Real CLI executor: `execFile` argv-style — no shell, so no quoting
 * injection. Exit != 0 → typed PortError carrying stderr. */
export const defaultRun: CliRunner = (cmd) =>
	Effect.callback<void, PortError>((resume) => {
		execFile(cmd[0]!, [...cmd.slice(1)], (err, _stdout, stderr) => {
			resume(
				err === null
					? Effect.void
					: Effect.fail(
							new PortError({
								port: "tts",
								message: `${cmd[0]} failed: ${String(stderr || err.message).slice(0, 300)}`,
							}),
						),
			);
		});
	});

/** ffmpeg args for one degradation pass, per NoiseProfile. Clean and
 * bandpass filter through `-af`; noise variants add a lavfi noise
 * source and mix — still a single ffmpeg invocation. */
export const ffmpegDegradeArgs = (
	input: string,
	output: string,
	profile: AcousticProfile,
): string[] => {
	const sr = String(profile.sampleRate);
	const noiseFilter: Record<Exclude<NoiseProfile, "clean">, { src: string; mix: string }> = {
		clinic: {
			src: "anoisesrc=color=brown:amplitude=0.015",
			mix: "amix=inputs=2:duration=first:weights=1 0.4",
		},
		phone_bandpass: {
			src: "anoisesrc=color=white:amplitude=0.008",
			mix: "amix=inputs=2:duration=first",
		},
		far_mic: { src: "anoisesrc=color=pink:amplitude=0.03", mix: "amix=inputs=2:duration=first" },
	};
	if (profile.noise === "clean") {
		return ["-y", "-i", input, "-af", `aresample=${sr}`, "-ac", "1", output];
	}
	const post =
		profile.noise === "phone_bandpass"
			? `highpass=f=300,lowpass=f=3400,aresample=${sr}`
			: profile.noise === "far_mic"
				? `lowpass=f=4500,volume=0.7,aresample=${sr}`
				: `aresample=${sr}`;
	const n = noiseFilter[profile.noise];
	return [
		"-y",
		"-i",
		input,
		"-f",
		"lavfi",
		"-i",
		n.src,
		"-filter_complex",
		`[0:a][1:a]${n.mix}[m];[m]${post}[out]`,
		"-map",
		"[out]",
		"-ac",
		"1",
		output,
	];
};

export const makeLocalTts = (opts: LocalTtsOptions): Layer.Layer<TtsPort> =>
	Layer.effect(
		TtsPort,
		Effect.gen(function* () {
			const sem = yield* Semaphore.make(opts.maxConcurrent ?? 2);
			const run = opts.run ?? defaultRun;
			const voices = { ...DEFAULT_VOICES, ...opts.voiceMap };
			const retry =
				opts.retry ?? Schedule.exponential("200 millis").pipe(Schedule.upTo({ times: 3 }));
			fs.mkdirSync(path.join(opts.workDir, "audio"), { recursive: true });

			const synthesize = (input: {
				readonly script: string;
				readonly voiceId: string;
				readonly acoustic: AcousticProfile;
			}) =>
				sem.withPermits(1)(
					Effect.gen(function* () {
						const started = Date.now();
						const voice = voices[input.voiceId];
						if (voice === undefined) {
							return yield* Effect.fail(
								new PortError({ port: "tts", message: `unknown voice alias: ${input.voiceId}` }),
							);
						}
						const key = crypto
							.createHash("sha256")
							.update(`${input.script}${input.voiceId}${input.acoustic.noise}`)
							.digest("hex")
							.slice(0, 24);
						const tmp = path.join(opts.workDir, "audio", `${key}.mp3`);
						const out = path.join(opts.workDir, "audio", `${key}.wav`);

						yield* run([
							"edge-tts",
							"--voice",
							voice,
							"--text",
							input.script,
							"--write-media",
							tmp,
						]).pipe(Effect.retry({ schedule: retry as Schedule.Schedule<unknown, PortError> }));

						yield* run(["ffmpeg", ...ffmpegDegradeArgs(tmp, out, input.acoustic)]).pipe(
							Effect.ensuring(
								Effect.sync(() => {
									try {
										fs.unlinkSync(tmp);
									} catch {
										/* temp already gone */
									}
								}),
							),
						);

						const audio = {
							uri: `file://${out}`,
							size: fs.statSync(out).size,
							contentType: "audio/wav",
						};
						return {
							audio,
							record: {
								runId: "tts",
								taskId: input.voiceId,
								stage: "synthesize",
								engine: "edge-tts",
								inputHash: key,
								startedAt: started,
								latencyMs: Date.now() - started,
							},
						};
					}),
				);

			return TtsPort.of({ synthesize });
		}),
	);

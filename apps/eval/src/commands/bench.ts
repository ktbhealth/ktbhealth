/**
 * bench — ASR Pareto benchmark over the committed pt-BR fixtures.
 *
 *   eval bench [--profile local|local-systemone] [--audio-dir d]
 *     [--results f] [--models a,b,c] [--python p] [--regen-audio]
 *
 * Ports the scripts/bench harness (packages/eval-adapter-local —
 * gen-audio.py → bench-asr.py → wer.ts, see BENCHMARK.md there)
 * into the CLI: optionally regenerates the s*.wav/s*.txt fixtures
 * via gen-audio.py (edge-tts + ffmpeg), runs bench-asr.py's
 * faster-whisper sweep, then scores every hypothesis against the
 * gold scripts with the domain `wer` — the same math wer.ts used.
 *
 * This is a MANUAL benchmark, not a suite run: it shells out to a
 * python env with faster-whisper + soundfile (BENCHMARK.md has the
 * uv recipe) and fails with named errors when python, the modules,
 * ffmpeg, or the fixtures are missing — never a silent skip.
 * `--profile` is accepted for consistency with the other commands
 * and validated against the same registry; only the local profiles
 * apply because the bench measures the faster-whisper sweep those
 * profiles' ASR adapter fronts.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { Console, Option, Schema } from "effect";
import { CliError, Command, Flag } from "effect/cli";

import { wer } from "@ktb/eval-consultation";

import type { CmdContext } from "../context.ts";
import { UsageError } from "../errors.ts";
import { knownProfiles } from "../resolve.ts";
import { userError } from "../shared.ts";

const optStr = Option.getOrUndefined;

// ---------- subprocess boundary (injectable for tests) ----------

interface BenchSpawnResult {
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: string;
}

/** Minimal spawn signature — (file, args, extra env) → result.
 * Tests inject fakes; production uses nodeSpawn. */
export type BenchSpawn = (
	file: string,
	args: readonly string[],
	extraEnv: Readonly<Record<string, string | undefined>>,
) => BenchSpawnResult;

/** Real subprocess spawn — node:child_process, runtime-agnostic.
 * The bench scripts are long-running (model downloads on first
 * use), so there is deliberately no timeout. */
export const nodeSpawn: BenchSpawn = (file, args, extraEnv) => {
	const r = spawnSync(file, [...args], {
		encoding: "utf8",
		env: { ...process.env, ...extraEnv },
	});
	return {
		status: r.status,
		stdout: r.stdout,
		stderr: r.stderr,
		...(r.error !== undefined ? { error: r.error.message } : {}),
	};
};

// ---------- fixtures + results ----------

/** bench-asr.py output row — kept in sync with scripts/bench/
 * bench-asr.py's JSON dump. */
const BenchResultRow = Schema.Struct({
	model: Schema.String,
	load_s: Schema.optionalKey(Schema.Number),
	rtf: Schema.Number,
	peak_rss_mb: Schema.Number,
	hyps: Schema.Array(Schema.String),
});
const BenchResults = Schema.Array(BenchResultRow);

interface BenchScore {
	readonly id: string;
	readonly wer: number;
	readonly hyp: string;
}

interface BenchModelReport {
	readonly model: string;
	readonly loadS: number | null;
	readonly rtf: number;
	readonly rssMb: number;
	readonly meanWer: number;
	readonly scores: readonly BenchScore[];
}

export interface BenchOptions {
	/** Directory holding gen-audio.py + bench-asr.py. */
	readonly benchDir: string;
	/** Directory holding s*.wav fixtures + s*.txt gold scripts. */
	readonly audioDir: string;
	/** Where bench-asr.py writes its JSON (BENCH_RESULTS). */
	readonly resultsPath: string;
	readonly models: readonly string[];
	readonly python: string;
	readonly regenAudio: boolean;
	readonly spawn: BenchSpawn;
}

interface Fixtures {
	readonly wavs: readonly string[];
	readonly missingTxt: readonly string[];
}

/** s*.wav fixtures + their s*.txt gold scripts. A missing audioDir
 * scans as empty (the caller regenerates or errors). */
const scanFixtures = (audioDir: string): Fixtures => {
	if (!fs.existsSync(audioDir)) return { wavs: [], missingTxt: [] };
	const wavs = fs
		.readdirSync(audioDir)
		.filter((f) => f.startsWith("s") && f.endsWith(".wav"))
		.sort();
	return {
		wavs,
		missingTxt: wavs.filter(
			(w) => !fs.existsSync(path.join(audioDir, w.slice(0, -".wav".length) + ".txt")),
		),
	};
};

const goldText = (audioDir: string, wav: string): string =>
	fs.readFileSync(path.join(audioDir, wav.replace(/\.wav$/, ".txt")), "utf8").trim();

const fixtureId = (wav: string): string => wav.replace(/\.wav$/, "");

/** Null when the spawn succeeded; otherwise a human-readable reason
 * (spawn error, non-zero exit + output tail). */
const spawnError = (what: string, r: BenchSpawnResult): string | null => {
	if (r.error !== undefined) return `${what}: ${r.error}`;
	if (r.status === 0) return null;
	const tail = (r.stderr + r.stdout).trim().split("\n").slice(-3).join(" ").trim();
	return `${what} failed (exit ${r.status})${tail === "" ? "" : `: ${tail}`}`;
};

const benchFail = (msg: string): CliError.UserError => userError(new Error(`eval bench: ${msg}`));

/**
 * Run the benchmark: fixtures → faster-whisper sweep → WER scoring.
 * Every subprocess goes through `opts.spawn` so tests inject fakes;
 * failures are CliError.UserError (exit 1) with the failing step
 * named — python missing, module missing, ffmpeg missing, sweep
 * failure, stale/mismatched results.
 */
const runBench = (opts: BenchOptions) =>
	Effect.gen(function* () {
		const env = { BENCH_AUDIO_DIR: opts.audioDir, BENCH_RESULTS: opts.resultsPath };

		// 1. Fixtures — regenerate via gen-audio.py when asked or when
		// the committed audio is absent. Regen needs edge-tts (python)
		// and ffmpeg (mp3→wav); both are checked BEFORE invoking so the
		// error names the missing piece.
		let fixtures = scanFixtures(opts.audioDir);
		if (opts.regenAudio || fixtures.wavs.length === 0) {
			const dep = spawnError(
				"python edge-tts check",
				opts.spawn(opts.python, ["-c", "import edge_tts"], {}),
			);
			if (dep !== null) {
				return yield* benchFail(
					`${dep} — audio regeneration needs the edge-tts python module (see BENCHMARK.md)`,
				);
			}
			const ff = spawnError("ffmpeg check", opts.spawn("ffmpeg", ["-version"], {}));
			if (ff !== null) {
				return yield* benchFail(`${ff} — gen-audio.py shells out to ffmpeg`);
			}
			const gen = spawnError(
				"gen-audio.py",
				opts.spawn(opts.python, [path.join(opts.benchDir, "gen-audio.py")], env),
			);
			if (gen !== null) return yield* benchFail(gen);
			fixtures = scanFixtures(opts.audioDir);
		}
		if (fixtures.wavs.length === 0) {
			return yield* benchFail(
				`no s*.wav fixtures under ${opts.audioDir} — pass --regen-audio to synthesize them (needs python edge-tts + ffmpeg)`,
			);
		}
		if (fixtures.missingTxt.length > 0) {
			return yield* benchFail(
				`gold script missing for ${fixtures.missingTxt
					.map((w) => w.replace(/\.wav$/, ".txt"))
					.join(", ")} under ${opts.audioDir}`,
			);
		}

		// 2. faster-whisper sweep — bench-asr.py reads BENCH_AUDIO_DIR /
		// BENCH_RESULTS from the environment (same contract as the
		// standalone script).
		const dep = spawnError(
			"python dependency check",
			opts.spawn(opts.python, ["-c", "import faster_whisper, soundfile"], {}),
		);
		if (dep !== null) {
			return yield* benchFail(
				`${dep} — bench-asr.py needs faster-whisper + soundfile (see BENCHMARK.md for the uv recipe)`,
			);
		}
		const sweep = spawnError(
			`bench-asr.py ${opts.models.join(" ")}`,
			opts.spawn(opts.python, [path.join(opts.benchDir, "bench-asr.py"), ...opts.models], env),
		);
		if (sweep !== null) return yield* benchFail(sweep);

		// 3. Score — same math as scripts/bench/wer.ts: per-fixture WER
		// of each hypothesis against its gold script, then the mean.
		const parsed = yield* Effect.try({
			try: () => JSON.parse(fs.readFileSync(opts.resultsPath, "utf8")) as unknown,
			catch: userError,
		});
		const results = Option.getOrNull(Schema.decodeUnknownOption(BenchResults)(parsed));
		if (results === null) {
			return yield* benchFail(
				`${opts.resultsPath} is not bench-asr.py output (expected a JSON array of {model, rtf, peak_rss_mb, hyps[]})`,
			);
		}

		const golds = fixtures.wavs.map((w) => goldText(opts.audioDir, w));
		const reports: BenchModelReport[] = [];
		for (const r of results) {
			if (r.hyps.length !== golds.length) {
				return yield* benchFail(
					`model "${r.model}" produced ${r.hyps.length} hypotheses for ${golds.length} fixtures — stale ${opts.resultsPath}? rerun the sweep`,
				);
			}
			const scores = r.hyps.map((h, i) => ({
				id: fixtureId(fixtures.wavs[i]!),
				wer: wer(golds[i]!, h),
				hyp: h,
			}));
			const mean = scores.reduce((a, s) => a + s.wer, 0) / scores.length;
			reports.push({
				model: r.model,
				loadS: r.load_s ?? null,
				rtf: r.rtf,
				rssMb: r.peak_rss_mb,
				meanWer: mean,
				scores,
			});
		}
		return reports;
	});

export const makeBenchCommand = (ctx: CmdContext, spawn: BenchSpawn = nodeSpawn) =>
	Command.make(
		"bench",
		{
			profile: Flag.optional(Flag.String("profile")),
			audioDir: Flag.optional(Flag.String("audio-dir")),
			results: Flag.optional(Flag.String("results")),
			models: Flag.optional(Flag.String("models")),
			python: Flag.optional(Flag.String("python")),
			regenAudio: Flag.Boolean("regen-audio").pipe(Flag.withDefault(false)),
		},
		(cfg) =>
			Effect.gen(function* () {
				// --profile: same registry validation as the other
				// commands. The bench measures the faster-whisper sweep
				// the local profiles' ASR adapter fronts — stub/cloud
				// profiles have nothing to benchmark.
				const profile = optStr(cfg.profile);
				if (profile !== undefined) {
					if (!knownProfiles().includes(profile)) {
						return yield* new UsageError({
							message: `unknown --profile "${profile}" (known: ${knownProfiles().join(", ")})`,
						});
					}
					if (profile !== "local" && profile !== "local-systemone") {
						return yield* new UsageError({
							message: `eval bench only applies to local profiles (got "${profile}") — it measures the faster-whisper sweep`,
						});
					}
				}
				const models = (optStr(cfg.models) ?? "tiny,base,small")
					.split(",")
					.map((m) => m.trim())
					.filter((m) => m !== "");
				if (models.length === 0) {
					return yield* new UsageError({ message: "--models must name at least one model" });
				}
				const benchDir = path.join(
					ctx.repoRoot,
					"packages",
					"eval-adapter-local",
					"scripts",
					"bench",
				);
				const reports = yield* runBench({
					benchDir,
					audioDir: optStr(cfg.audioDir) ?? path.join(benchDir, "audio"),
					resultsPath: optStr(cfg.results) ?? path.join(benchDir, "asr-results.json"),
					models,
					python: optStr(cfg.python) ?? ctx.env.EVAL_BENCH_PYTHON ?? "python3",
					regenAudio: cfg.regenAudio,
					spawn,
				});
				for (const m of reports) {
					yield* Console.log(
						`=== ${m.model} (load=${m.loadS === null ? "-" : `${m.loadS}s`} rtf=${m.rtf} rss=${m.rssMb}MB) mean WER=${m.meanWer.toFixed(3)}`,
					);
					for (const s of m.scores) {
						yield* Console.log(`  ${s.id}: wer=${s.wer.toFixed(2)}  "${s.hyp}"`);
					}
				}
			}),
	).pipe(
		Command.withDescription(
			"ASR Pareto benchmark — faster-whisper sweep scored against gold scripts (see packages/eval-adapter-local/scripts/bench/BENCHMARK.md).",
		),
	);

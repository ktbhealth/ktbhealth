/**
 * generate — dataset generation for a suite.
 *
 *   eval generate <suite> [--profile p] [--n N|--personas N]
 *     [--step N] [--seed N] [--workdir d] [--locale pt-BR]
 *     [--template consultation] [--noise clean] [--concurrency N]
 *     [--run-id id]
 *
 * Persona matrix (sub-sampled) → Eta script → TTS → sqlite manifest +
 * blob provenance + JSONL report — the same flow as the retired
 * eval-adapter-local generate script, now driven by the suite
 * manifest's dataset pin and resolved adapter profile.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { Console, Option, Schema } from "effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { Argument, Command, Flag } from "effect/cli";

import {
	DEFAULT_MATRIX,
	generateDataset,
	NoiseProfile,
	sampleMatrix,
	type AcousticProfile,
	type Persona,
} from "@ktb/eval-consultation";

import { modelLayer, storeReportLayers, type WireContext } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { CommandExit, UsageError } from "../errors.ts";
import { findSuite } from "../suites.ts";
import {
	assertCapabilities,
	datasetVersionOf,
	intFlag,
	isTransientBatchError,
	localeFlag,
	outcomeMark,
	resolveFor,
	selectProfile,
	userError,
	workdirFlag,
} from "../shared.ts";

const optStr = Option.getOrUndefined;

export const makeGenerateCommand = (ctx: CmdContext) =>
	Command.make(
		"generate",
		{
			suite: Argument.String("suite"),
			profile: Flag.optional(Flag.String("profile")),
			n: Flag.optional(Flag.Int("n")),
			personas: Flag.optional(Flag.Int("personas")),
			step: Flag.optional(Flag.Int("step")),
			seed: Flag.optional(Flag.Int("seed")),
			workdir: Flag.optional(Flag.String("workdir")),
			locale: Flag.optional(Flag.String("locale")),
			template: Flag.optional(Flag.String("template")),
			noise: Flag.optional(Flag.String("noise")),
			concurrency: Flag.optional(Flag.Int("concurrency")),
			runId: Flag.optional(Flag.String("run-id")),
		},
		(cfg) =>
			Effect.gen(function* () {
				const suite = yield* Effect.tryPromise({
					try: () => findSuite(ctx.evalsDir, cfg.suite),
					catch: userError,
				});
				const manifest = suite.manifest;
				const profile = yield* selectProfile(cfg.profile, suite);
				const { resolution } = resolveFor(suite, profile);
				// Generation needs TTS + persistence; llm/asr/eval are
				// run-time concerns and may legitimately be absent from a
				// generate-only profile.
				yield* assertCapabilities(suite, resolution, ["tts"]);

				const count = yield* intFlag("n", Option.isSome(cfg.n) ? cfg.n : cfg.personas, 8, 1);
				const step = yield* intFlag("step", cfg.step, 7, 1);
				const seed = yield* intFlag("seed", cfg.seed, 100, 0);
				const concurrency = yield* intFlag("concurrency", cfg.concurrency, 2, 1);
				const workdir = yield* workdirFlag(cfg.workdir);

				// localeFlag validates the name; `locale` is the raw tag
				// the template directory is keyed by ("pt-BR", not the
				// profile's normalization id "ptbr-v1").
				const locale = optStr(cfg.locale) ?? "pt-BR";
				const localeProfile = yield* localeFlag(cfg.locale);
				const noiseRaw = optStr(cfg.noise) ?? "clean";
				if (!Schema.is(NoiseProfile)(noiseRaw)) {
					return yield* new UsageError({
						message: `--noise must be one of ${NoiseProfile.literals.join("|")}, got: ${noiseRaw}`,
					});
				}
				const noise: AcousticProfile["noise"] = noiseRaw;
				const templateName = optStr(cfg.template) ?? "consultation";
				if (
					templateName === "" ||
					templateName.includes("/") ||
					templateName.includes("\\") ||
					templateName.includes("..")
				) {
					return yield* new UsageError({
						message: `--template must be a bare template name, got: ${templateName}`,
					});
				}
				const template = yield* Effect.try({
					try: () =>
						fs.readFileSync(
							path.join(
								ctx.repoRoot,
								"evals/consultation/templates",
								locale,
								`${templateName}.eta`,
							),
							"utf8",
						),
					catch: userError,
				});

				const datasetVersion = datasetVersionOf(manifest);
				const runId = optStr(cfg.runId) ?? `gen-${manifest.id}-${Date.now()}`;
				const ttsKey = resolution.adapters.tts ?? "stub";
				const voices = ["br_male_1", "br_female_1"];
				const acoustic = (_p: Persona, i: number): AcousticProfile => ({
					ttsModel: ttsKey,
					voiceId: voices[i % voices.length]!,
					noise,
					sampleRate: 16000,
				});

				const personas = sampleMatrix(DEFAULT_MATRIX, step).slice(0, count);
				const wire: WireContext = {
					workdir,
					profile,
					env: ctx.env,
					...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
				};
				const { store, report } = storeReportLayers(workdir);
				// modelLayer throws on undeclared/unimplemented adapters —
				// lift it into the error channel (exit 1, message shown).
				const layer = yield* Effect.try({
					try: () => Layer.mergeAll(modelLayer(wire, resolution.adapters, "tts"), store, report),
					catch: userError,
				});

				const result = yield* Effect.scoped(
					Effect.gen(function* () {
						return yield* generateDataset({
							runId,
							datasetVersion,
							personas,
							template,
							profile: localeProfile,
							acoustic,
							seed,
							batch: {
								concurrency,
								retry: Schedule.exponential("300 millis").pipe(Schedule.upTo({ times: 2 })),
								retryWhile: isTransientBatchError,
								timeoutMs: 120_000,
							},
						});
					}).pipe(Effect.provide(layer)),
				);

				for (const o of result.outcomes) {
					yield* Console.log(
						`  [${o.index}] ${o.item.region}/${o.item.specialty} — ${outcomeMark(o, () => "ok")} (${o.attempts} attempts)`,
					);
				}
				yield* Console.log(
					`\n${result.ok.length} persisted, ${result.failed.length} failed in ${result.latencyMs}ms → ${workdir}`,
				);
				if (result.failed.length > 0) {
					return yield* new CommandExit({ code: 1 });
				}
			}),
	).pipe(Command.withDescription("Persona matrix → script → TTS → dataset store for a suite."));

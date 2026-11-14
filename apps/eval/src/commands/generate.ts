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

import { EvalStorePort, type DatasetManifest, type Experiment } from "@ktb/eval-core";
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
import {
	domainErrorMessage,
	domainForManifest,
	jsonNumber,
	jsonRecord,
	jsonString,
	jsonStringArray,
	loadDomains,
} from "../domains.ts";
import { CommandExit, UsageError } from "../errors.ts";
import { findSuite } from "../suites.ts";
import {
	assertCapabilities,
	datasetVersionOf,
	gitSha,
	intFlag,
	isTransientBatchError,
	localeSelection,
	manifestHashOf,
	outcomeMark,
	resolveFor,
	selectProfile,
	sha256Hex,
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
				// Domain definition (P-079): the manifest's `domain` id
				// resolves to a discovered domain.ts (extends chain +
				// domainParams overrides merged). Absent definition →
				// pre-P-079 defaults below; invalid domainParams is a
				// manifest bug → usage error.
				const domains = yield* Effect.tryPromise({
					try: () => loadDomains(ctx.evalsDir),
					catch: userError,
				});
				const effDomain = yield* Effect.try({
					try: () => domainForManifest(domains, manifest),
					catch: (e) => new UsageError({ message: domainErrorMessage(e) }),
				});
				// Generation needs TTS + persistence; llm/asr/eval are
				// run-time concerns and may legitimately be absent from a
				// generate-only profile.
				yield* assertCapabilities(suite, resolution, ["tts"]);

				// Domain params (P-079): `params.dataset` supplies the
				// generator defaults flags fall back to; `params.voices`
				// the voice rotation. Flags always win.
				const domainParams = effDomain?.definition.params;
				const dsParams = jsonRecord(domainParams?.dataset);
				const dsNum = (k: string): number | undefined => jsonNumber(dsParams?.[k]);
				const dsStr = (k: string): string | undefined => jsonString(dsParams?.[k]);

				const count = yield* intFlag(
					"n",
					Option.isSome(cfg.n) ? cfg.n : cfg.personas,
					dsNum("count") ?? 8,
					1,
				);
				const step = yield* intFlag("step", cfg.step, dsNum("step") ?? 7, 1);
				const seed = yield* intFlag("seed", cfg.seed, dsNum("seed") ?? 100, 0);
				const concurrency = yield* intFlag("concurrency", cfg.concurrency, 2, 1);
				const workdir = yield* workdirFlag(cfg.workdir);

				// localeSelection resolves --locale → domain locale.tag/
				// profile → pt-BR; `tag` is the raw locale name the
				// template directory is keyed by ("pt-BR", not the
				// profile's normalization id "ptbr-v1").
				const localeSel = yield* localeSelection(effDomain, cfg.locale);
				const locale = localeSel.tag;
				const localeProfile = localeSel.profile;
				const noiseRaw = optStr(cfg.noise) ?? dsStr("noise") ?? "clean";
				if (!Schema.is(NoiseProfile)(noiseRaw)) {
					return yield* new UsageError({
						message: `--noise must be one of ${NoiseProfile.literals.join("|")}, got: ${noiseRaw}`,
					});
				}
				const noise: AcousticProfile["noise"] = noiseRaw;
				const templateName =
					optStr(cfg.template) ?? effDomain?.definition.templates?.name ?? "consultation";
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
				// templates.dir is pack-relative — resolve against each
				// chain dir (leaf first) so an extending domain still
				// finds templates declared by its parent pack. No
				// templates section (or no domain definition) → the
				// pre-P-079 consultation path.
				const templateRel = effDomain?.definition.templates?.dir;
				const templateCandidates =
					templateRel !== undefined && effDomain !== undefined && effDomain.dirs.length > 0
						? effDomain.dirs.map((d) => path.join(d, templateRel))
						: [path.join(ctx.repoRoot, "evals", "consultation", "templates")];
				const templateDir =
					templateCandidates.find((d) => fs.existsSync(d)) ?? templateCandidates[0]!;
				const template = yield* Effect.try({
					try: () => fs.readFileSync(path.join(templateDir, locale, `${templateName}.eta`), "utf8"),
					catch: userError,
				});

				const datasetVersion = datasetVersionOf(manifest);
				const runId = optStr(cfg.runId) ?? `gen-${manifest.id}-${Date.now()}`;
				const startedAt = Date.now();
				const ttsKey = resolution.adapters.tts ?? "stub";
				const voices = jsonStringArray(domainParams?.voices) ?? ["br_male_1", "br_female_1"];
				const acoustic = (_p: Persona, i: number): AcousticProfile => ({
					ttsModel: ttsKey,
					voiceId: voices[i % voices.length]!,
					noise,
					sampleRate: 16000,
				});

				// Persona matrix from the domain definition (P-079) —
				// domainParams.personas may have narrowed it; absent a
				// definition, the pack's DEFAULT_MATRIX applies.
				const matrix = effDomain?.definition.personas ?? DEFAULT_MATRIX;
				const personas = sampleMatrix(matrix, step).slice(0, count);
				const wire: WireContext = {
					workdir,
					profile,
					env: ctx.env,
					...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
				};
				const { store, report, evalStore } = storeReportLayers(workdir);
				// modelLayer throws on undeclared/unimplemented adapters —
				// lift it into the error channel (exit 1, message shown).
				const layer = yield* Effect.try({
					try: () =>
						Layer.mergeAll(modelLayer(wire, resolution.adapters, "tts"), store, report, evalStore),
					catch: userError,
				});

				const result = yield* Effect.scoped(
					Effect.gen(function* () {
						const r = yield* generateDataset({
							runId,
							datasetVersion,
							personas,
							template,
							profile: localeProfile,
							acoustic,
							seed,
							...(domainParams !== undefined ? { domainParams } : {}),
							batch: {
								concurrency,
								retry: Schedule.exponential("300 millis").pipe(Schedule.upTo({ times: 2 })),
								retryWhile: isTransientBatchError,
								timeoutMs: 120_000,
							},
						});

						// Market-parity artifacts (P-076): the generated
						// cohort registers a DatasetManifest (id+version
						// pinned by contentHash — a same-version regen with
						// different content is rejected by the store) and
						// every invocation records an Experiment. Written
						// even on partial failure: the manifest only
						// counts PERSISTED samples, the experiment records
						// the honest ok/failed split.
						const evals = yield* EvalStorePort;
						const persisted = r.ok.map((g) => g.sample);
						if (persisted.length > 0) {
							const datasetDoc: DatasetManifest = {
								id: manifest.dataset.id,
								version: manifest.dataset.version,
								domain: manifest.domain,
								generator: {
									suiteId: manifest.id,
									count,
									step,
									seed,
									locale,
									template: templateName,
									noise,
									tts: ttsKey,
									datasetVersion,
									...(domainParams !== undefined ? { domainParams } : {}),
								},
								provenance: { generatedBy: "eval generate", runId },
								createdAt: Date.now(),
								sampleCount: persisted.length,
								// Content pin: sorted id+scriptHash pairs — any
								// change to the cohort (persona, seed, template)
								// changes the hash.
								contentHash: sha256Hex(
									persisted
										.map((s) => `${s.id}:${s.scriptHash}`)
										.sort()
										.join("\n"),
								),
							};
							yield* evals.putDatasetManifest(datasetDoc).pipe(Effect.mapError(userError));
						}
						const sha = gitSha(ctx.repoRoot);
						const experiment: Experiment = {
							id: runId,
							kind: "generate",
							suiteId: manifest.id,
							manifestHash: manifestHashOf(manifest),
							...(sha !== undefined
								? { gitSha: sha }
								: /* v8 ignore next -- gitSha is only undefined outside a git checkout or without git; tests always run inside the repo */ {}),
							profile,
							dataset: { id: manifest.dataset.id, version: manifest.dataset.version },
							startedAt,
							finishedAt: Date.now(),
							summary: {
								samples: persisted.length,
								failed: r.failed.length,
								latencyMs: r.latencyMs,
								datasetVersion,
								...(domainParams !== undefined ? { domainParams } : {}),
							},
						};
						yield* evals.putExperiment(experiment).pipe(Effect.mapError(userError));
						return r;
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

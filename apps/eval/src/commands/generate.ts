/**
 * generate — dataset generation for a suite (P-074 phase 4).
 *
 *   eval generate <suite> [--profile p] [--n N|--personas N]
 *     [--step N] [--seed N] [--workdir d] [--locale pt-BR]
 *     [--template consultation] [--noise clean] [--concurrency N]
 *     [--run-id id]
 *
 * Persona matrix (sub-sampled) → Eta script → TTS → sqlite manifest +
 * blob provenance + JSONL report — the same flow as
 * packages/eval-dataset-local/scripts/generate.ts, now driven by the
 * suite manifest's dataset pin and resolved adapter profile.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { Schema } from "effect";

import {
	DEFAULT_MATRIX,
	generateDataset,
	NoiseProfile,
	ptBR,
	sampleMatrix,
	type AcousticProfile,
	type LocaleProfile,
	type Persona,
} from "@ktb/eval-consult";

import { intFlag, parseArgs, strFlag } from "../args.ts";
import { modelLayer, storeReportLayers, type WireContext } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { findSuite } from "../suites.ts";
import {
	assertCapabilities,
	datasetVersionOf,
	outcomeMark,
	resolveFor,
	selectProfile,
	workdirFlag,
} from "../shared.ts";

const LOCALES: Record<string, LocaleProfile> = { "pt-BR": ptBR };

const SPEC = {
	positionals: ["suite"],
	flags: {
		profile: "string",
		n: "int",
		personas: "int",
		step: "int",
		seed: "int",
		workdir: "string",
		locale: "string",
		template: "string",
		noise: "string",
		concurrency: "int",
		"run-id": "string",
	},
} as const;

export const generateCommand = async (
	argv: readonly string[],
	ctx: CmdContext,
): Promise<number> => {
	const args = parseArgs(argv, SPEC);
	const suite = await findSuite(ctx.evalsDir, args.positional.suite!);
	const manifest = suite.manifest;
	const profile = selectProfile(args, suite);
	const { resolution } = resolveFor(suite, profile);
	// Generation needs TTS + persistence; llm/asr/eval are run-time
	// concerns and may legitimately be absent from a generate-only
	// profile.
	assertCapabilities(suite, resolution, ["tts"]);

	const count =
		args.flags.n !== undefined ? intFlag(args, "n", 8, 1) : intFlag(args, "personas", 8, 1);
	const step = intFlag(args, "step", 7, 1);
	const seed = intFlag(args, "seed", 100, 0);
	const concurrency = intFlag(args, "concurrency", 2, 1);
	const workdir = workdirFlag(args);
	const locale = strFlag(args, "locale", "pt-BR")!;
	const localeProfile = LOCALES[locale];
	if (localeProfile === undefined) {
		throw new Error(`unknown --locale ${locale} (available: ${Object.keys(LOCALES).join(", ")})`);
	}
	const noiseRaw = strFlag(args, "noise", "clean")!;
	if (!Schema.is(NoiseProfile)(noiseRaw)) {
		throw new Error(`--noise must be one of ${NoiseProfile.literals.join("|")}, got: ${noiseRaw}`);
	}
	const noise: AcousticProfile["noise"] = noiseRaw;
	const templateName = strFlag(args, "template", "consultation")!;
	if (
		templateName === "" ||
		templateName.includes("/") ||
		templateName.includes("\\") ||
		templateName.includes("..")
	) {
		throw new Error(`--template must be a bare template name, got: ${templateName}`);
	}
	const template = fs.readFileSync(
		path.join(ctx.repoRoot, "plugins/eval-consult/templates", locale, `${templateName}.eta`),
		"utf8",
	);

	const datasetVersion = datasetVersionOf(manifest);
	const runId = strFlag(args, "run-id") ?? `gen-${manifest.id}-${Date.now()}`;
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
	const layer = Layer.mergeAll(modelLayer(wire, resolution.adapters, "tts"), store, report);

	const result = await Effect.runPromise(
		Effect.scoped(
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
						timeoutMs: 120_000,
					},
				});
			}).pipe(Effect.provide(layer)),
		),
	);

	for (const o of result.outcomes) {
		console.log(
			`  [${o.index}] ${o.item.region}/${o.item.specialty} — ${outcomeMark(o, () => "ok")} (${o.attempts} attempts)`,
		);
	}
	console.log(
		`\n${result.ok.length} persisted, ${result.failed.length} failed in ${result.latencyMs}ms → ${workdir}`,
	);
	return result.failed.length > 0 ? 1 : 0;
};

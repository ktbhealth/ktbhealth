/**
 * eval:generate — dataset generation runner (T-102).
 *
 *   bun packages/eval-dataset-local/scripts/generate.ts \
 *     --workdir /tmp/eval-data --personas 8 --seed 100 --tts stub
 *
 * Persona matrix (sub-sampled) → Eta script → TTS → SQLite manifest +
 * JSONL report. Resilience via runBatch: concurrency cap, retry
 * schedule, per-sample failure isolation.
 *
 * --tts stub  : no network, deterministic fake audio (dev/CI)
 * --tts edge  : edge-tts CLI + ffmpeg (needs both on PATH; network)
 */
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { Schema } from "effect";

import {
	DEFAULT_MATRIX,
	generateDataset,
	ptBR,
	sampleMatrix,
	NoiseProfile,
	type Persona,
	type AcousticProfile,
	type LocaleProfile,
} from "@ktb/eval-dataset";
import { TtsPort } from "@ktb/eval-dataset";

import { makeLocalReportLayer, makeLocalStoreLayer, makeLocalTts } from "../src/index.ts";

const arg = (name: string, def: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : def;
};

const intArg = (name: string, def: number, min: number): number => {
	const raw = arg(name, String(def));
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min) {
		throw new Error(`--${name} must be an integer >= ${min}, got: ${raw}`);
	}
	return n;
};

const workdir = arg("workdir", path.join(os.tmpdir(), "eval-generate"));
// Same scratch-path guard as scripts/demo.ts — refuse anything that
// is not clearly a scratch path so a bad argv cannot write into a
// real directory. Must be under os.tmpdir() or <cwd>/tmp.
const resolvedWorkdir = path.resolve(workdir);
const scratchRoots = [
	path.resolve(os.tmpdir()),
	fs.realpathSync(os.tmpdir()),
	path.resolve(process.cwd(), "tmp"),
];
const isScratch = scratchRoots.some(
	(r) => resolvedWorkdir === r || resolvedWorkdir.startsWith(`${r}${path.sep}`),
);
if (!isScratch) {
	throw new Error(`--workdir must live under ${scratchRoots.join(" or ")}, got: ${workdir}`);
}

const count = intArg("personas", 8, 1);
const seed = intArg("seed", 100, 0);
const step = intArg("step", 7, 1);
const templateName = arg("template", "consultation");
const locale = arg("locale", "pt-BR");
// Locale → profile registry: the template dir and the script content
// MUST come from the same locale — without this, --locale xx would
// render xx templates with pt-BR slot tables and gold entities.
const LOCALES: Record<string, LocaleProfile> = { "pt-BR": ptBR };
const profile = LOCALES[locale];
if (!profile) {
	throw new Error(`unknown --locale ${locale} (available: ${Object.keys(LOCALES).join(", ")})`);
}
const noiseRaw = arg("noise", "clean");
const ttsKind = arg("tts", "stub");
const concurrency = intArg("concurrency", 2, 1);

if (!Schema.is(NoiseProfile)(noiseRaw)) {
	throw new Error(`--noise must be one of ${NoiseProfile.literals.join("|")}, got: ${noiseRaw}`);
}
const noise: AcousticProfile["noise"] = noiseRaw;

// --template is joined into a path — reject anything that could
// traverse out of templates/ before touching the filesystem.
if (
	templateName === "" ||
	templateName.includes("/") ||
	templateName.includes("\\") ||
	templateName.includes("..")
) {
	throw new Error(`--template must be a bare template name, got: ${templateName}`);
}

const template = fs.readFileSync(
	new URL(`../../eval-dataset/templates/${locale}/${templateName}.eta`, import.meta.url),
	"utf8",
);

const runId = `gen-${Date.now()}`;

const personas = sampleMatrix(DEFAULT_MATRIX, step).slice(0, count);
const voices = ["br_male_1", "br_female_1"];
const acoustic = (_p: Persona, i: number): AcousticProfile => ({
	ttsModel: ttsKind,
	voiceId: voices[i % voices.length]!,
	noise,
	sampleRate: 16000,
});

const store = makeLocalStoreLayer(workdir);
const report = makeLocalReportLayer(path.join(workdir, "reports", "generate.jsonl"));
const tts =
	ttsKind === "edge"
		? makeLocalTts({ workDir: path.join(workdir, "tts"), voiceMap: {} })
		: Layer.succeed(
				TtsPort,
				TtsPort.of({
					synthesize: ({ voiceId }) =>
						Effect.succeed({
							audio: { uri: `stub://tts/${voiceId}`, size: 8 },
							record: {
								runId: "gen",
								taskId: voiceId,
								stage: "synthesize",
								engine: "stub-tts",
								inputHash: "h",
								startedAt: Date.now(),
							},
						}),
				}),
			);

const result = await Effect.runPromise(
	Effect.scoped(
		Effect.gen(function* () {
			return yield* generateDataset({
				runId,
				datasetVersion: `gen-${new Date().toISOString().slice(0, 10)}`,
				personas,
				template,
				profile,
				acoustic,
				seed,
				batch: {
					concurrency,
					retry: Schedule.exponential("300 millis").pipe(Schedule.upTo({ times: 2 })),
					timeoutMs: 120_000,
				},
			});
		}).pipe(Effect.provide(Layer.mergeAll(store, report, tts))),
	),
);

for (const o of result.outcomes) {
	const mark =
		o.status === "ok" ? "ok" : o.status === "failed" ? `FAIL ${o.error?.message}` : "TIMEOUT";
	console.log(
		`  [${o.index}] ${o.item.region}/${o.item.specialty} — ${mark} (${o.attempts} attempts)`,
	);
}
console.log(
	`\n${result.ok.length} persisted, ${result.failed.length} failed in ${result.latencyMs}ms → ${workdir}`,
);

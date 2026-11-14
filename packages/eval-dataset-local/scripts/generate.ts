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

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import {
	DEFAULT_MATRIX,
	generateDataset,
	ptBR,
	sampleMatrix,
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

const workdir = arg("workdir", "/tmp/eval-generate");
const count = Number(arg("personas", "8"));
const seed = Number(arg("seed", "100"));
const step = Number(arg("step", "7"));
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
const noise = arg("noise", "clean") as AcousticProfile["noise"];
const ttsKind = arg("tts", "stub");
const concurrency = Number(arg("concurrency", "2"));

const template = fs.readFileSync(
	new URL(`../../eval-dataset/templates/${locale}/${templateName}.eta`, import.meta.url),
	"utf8",
);

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
				datasetVersion: `gen-${new Date().toISOString().slice(0, 10)}`,
				personas,
				template,
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

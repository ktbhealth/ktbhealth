/**
 * Manual demo of the eval platform, end-to-end, zero model cost:
 *
 *   bun packages/eval-dataset-local/scripts/demo.ts [rootDir]
 *
 * Persona matrix → 3 stub samples → pipeline (ASR + cleanup + Jev-style
 * judging, all stubbed) → persisted into the LOCAL adapters
 * (SQLite manifest + blob dir + JSONL report). Then inspect:
 *
 *   sqlite3 <root>/manifest.sqlite 'select id, origin, dataset_version from samples'
 *   ls <root>/blobs
 *   cat <root>/reports/run.jsonl
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";

import {
	DatasetStorePort,
	ReportPort,
	expandPersonaMatrix,
	processSample,
	recordAll,
	saveResult,
	saveSample,
	toSampleResult,
	type ExpectedEntity,
	type Sample,
} from "@ktb/eval-dataset";
import { makeStubLayer } from "@ktb/eval-dataset-stub";

/** Tiny valid WAV (mono 16-bit PCM, 0.6s tone) so demo blobs are
 * playable in any audio player — real speech arrives with TtsPort. */
const makeToneWav = (freq: number): Uint8Array => {
	const rate = 8000;
	const seconds = 0.6;
	const n = rate * seconds;
	const data = new Uint8Array(44 + n * 2);
	const view = new DataView(data.buffer);
	const writeStr = (o: number, s: string) => {
		for (let i = 0; i < s.length; i++) data[o + i] = s.charCodeAt(i);
	};
	writeStr(0, "RIFF");
	view.setUint32(4, 36 + n * 2, true);
	writeStr(8, "WAVE");
	writeStr(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeStr(36, "data");
	view.setUint32(40, n * 2, true);
	for (let i = 0; i < n; i++) {
		const env = Math.min(1, i / 400, (n - i) / 400);
		view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * env * 12000, true);
	}
	return data;
};

import { makeLocalReportLayer, makeLocalStoreLayer } from "../src/index.ts";

const root = process.argv[2] ?? path.resolve(process.cwd(), "tmp", "demo-dataset");
// The demo wipes its output dir — refuse anything that is not clearly a
// scratch path, so a bad argv cannot nuke a real directory. Must be
// under os.tmpdir() or <cwd>/tmp — a bare "/tmp/" substring check would
// also pass for e.g. /home/user/stuff/tmp/data.
const resolved = path.resolve(root);
const scratchRoots = [path.resolve(os.tmpdir()), path.resolve(process.cwd(), "tmp")];
const isScratch = scratchRoots.some(
	(r) => resolved === r || resolved.startsWith(`${r}${path.sep}`),
);
if (!isScratch) {
	throw new Error(`demo root must live under ${scratchRoots.join(" or ")}, got: ${root}`);
}
fs.rmSync(root, { recursive: true, force: true });

const personas = expandPersonaMatrix({
	regions: ["sudeste", "nordeste"],
	ageBands: ["adulto", "idoso"],
	registers: ["colloquial"],
	specialties: ["clinico_geral"],
});
console.log(`\n== persona matrix (2x2x1x1) → ${personas.length} cells ==`);
for (const p of personas) console.log("  ", JSON.stringify(p));

// Gold-annotated entities live ON the sample now — persisted in the
// manifest like phase-2 physician annotation will be.
const entities: ExpectedEntity[] = [
	{ category: "medication", value: "dipirona" },
	{ category: "date", value: "três dias" },
];

const samples: Sample[] = personas.map((persona, i) => ({
	id: `demo-${i}`,
	datasetVersion: "demo-v1",
	origin: "synthetic",
	script: "Doctor: o que você está sentindo? Patient: dor de cabeça forte há três dias.",
	scriptHash: `hash-${i}`,
	persona,
	audio: { uri: `blob:audio/${i}.wav`, contentType: "audio/wav" },
	gold: { validatedBy: "generator", entities },
}));

const runId = `demo-${Date.now()}`;
const { layer: stubs } = makeStubLayer();
const store = makeLocalStoreLayer(root);
const report = makeLocalReportLayer(path.join(root, "reports", "run.jsonl"));

console.log(`\n== processing ${samples.length} samples (stub ASR + cleanup + judge) ==`);
for (const [i, sample] of samples.entries()) {
	const run = await Effect.runPromise(Effect.provide(processSample({ sample, runId }), stubs));
	console.log(`\n[${sample.id}] ${sample.persona.region}/${sample.persona.ageBand}`);
	console.log(`  ASR       : "${run.asr.text}"`);
	console.log(`  corrected : "${run.corrected}"`);
	console.log(
		`  edits     : ${run.edits.ops
			.map((o) => `"${o.remove}"→"${o.insert}"${o.flagged ? " [flagged]" : ""}`)
			.join(", ")}`,
	);
	console.log(
		`  WER raw=${run.asrMetrics.wer.toFixed(2)} corrected=${run.correctedMetrics.wer.toFixed(2)}` +
			` | critical raw=${run.asrMetrics.criticalErrors} corrected=${run.correctedMetrics.criticalErrors}`,
	);
	console.log(
		`  edit verdicts: ${run.editVerdicts.map((v) => v.classification).join(", ") || "-"}`,
	);
	console.log(`  confidence  : ${run.confSegments.map((s) => s.confidence).join(", ")}`);

	await Effect.runPromise(Effect.provide(saveSample(sample), store));
	if (sample.audio) {
		const uri = sample.audio.uri;
		await Effect.runPromise(
			Effect.provide(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putBlob(uri, makeToneWav(300 + i * 100));
				}),
				store,
			),
		);
	}
	// Persist the whole audit trail: every stage's run-record + the
	// per-sample eval result (metrics, verdicts, diffs).
	await Effect.runPromise(Effect.provide(recordAll(run.records), report));
	await Effect.runPromise(
		Effect.provide(saveResult(toSampleResult({ sample, runId, run })), store),
	);
}

// round-trip proof: read one sample + its persisted result back
const back = await Effect.runPromise(
	Effect.provide(
		Effect.gen(function* () {
			const s = yield* DatasetStorePort;
			return yield* s.getSample("demo-0");
		}),
		store,
	),
);
console.log(`\n== store round-trip: getSample("demo-0") →`, back?.id ?? "MISSING");

const results = await Effect.runPromise(
	Effect.provide(
		Effect.gen(function* () {
			const s = yield* DatasetStorePort;
			return yield* s.listResults({ runId });
		}),
		store,
	),
);
console.log(
	`== persisted results: ${results.length} rows — e.g. demo-0 WER ` +
		`${results[0]?.asrMetrics?.wer.toFixed(2)} → ${results[0]?.correctedMetrics?.wer.toFixed(2)}`,
);

const md = await Effect.runPromise(
	Effect.provide(
		Effect.gen(function* () {
			const r = yield* ReportPort;
			return yield* r.render(runId);
		}),
		report,
	),
);
console.log("\n== rendered report ==\n" + md);

console.log(`inspect the dataset on disk:\n  ${root}`);

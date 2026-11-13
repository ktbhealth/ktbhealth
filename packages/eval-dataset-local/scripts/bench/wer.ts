/**
 * Scores bench-asr.py output against the known TTS scripts.
 * Usage: `bun scripts/bench/wer.ts [results.json] [audioDir]`
 * audioDir holds `s0..s4.txt` gold scripts produced by gen-audio.py.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { wer } from "@ktb/eval-dataset";

interface BenchResult {
	readonly model: string;
	readonly rtf: number;
	readonly peak_rss_mb: number;
	readonly hyps: readonly string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const resultsPath = process.argv[2] ?? join(here, "asr-results.json");
const audioDir = process.argv[3] ?? join(here, "audio");
const results = JSON.parse(readFileSync(resultsPath, "utf8")) as BenchResult[];

const golds = ["s0", "s1", "s2", "s3", "s4"].map((s) =>
	readFileSync(join(audioDir, `${s}.txt`), "utf8").trim(),
);

for (const r of results) {
	const wers = r.hyps.map((h, i) => wer(golds[i]!, h));
	const mean = wers.reduce((a, b) => a + b, 0) / wers.length;
	console.log(
		`\n=== ${r.model} (rtf=${r.rtf}, rss=${r.peak_rss_mb}MB) mean WER=${mean.toFixed(3)}`,
	);
	wers.forEach((w, i) => console.log(`  s${i}: wer=${w.toFixed(2)}  "${r.hyps[i]}"`));
}

/**
 * bench — deferred.
 *
 * The ASR benchmark harness (audio generation, faster-whisper sweep,
 * WER analysis) lives in packages/eval-dataset-local/scripts/bench —
 * it is a Python+Bun pipeline, not a suite command. apps/eval will
 * grow a `bench` verb when a suite manifest can declare a benchmark
 * cohort; until then this prints the pointer and exits non-zero so a
 * scripted caller can't mistake it for a completed run.
 */

import type { CmdContext } from "../context.ts";

export const benchCommand = async (_argv: readonly string[], _ctx: CmdContext): Promise<number> => {
	console.error(
		"eval bench: not yet wired — see packages/eval-dataset-local/scripts/bench " +
			"(gen-audio.py, bench-asr.py, wer.ts, BENCHMARK.md)",
	);
	return 2;
};

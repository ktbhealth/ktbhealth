/**
 * bench — deferred.
 *
 * The ASR benchmark harness (audio generation, faster-whisper sweep,
 * WER analysis) lives in
 * packages/eval-adapter-local/scripts/bench — it is a Python+Bun
 * pipeline, not a suite command. apps/eval will grow a `bench` verb
 * when a suite manifest can declare a benchmark cohort; until then
 * this prints the pointer and exits 2 so a scripted caller can't
 * mistake it for a completed run.
 */

import * as Effect from "effect/Effect";
import { Console } from "effect";
import { Command } from "effect/cli";

import type { CmdContext } from "../context.ts";
import { CommandExit } from "../errors.ts";

export const makeBenchCommand = (_ctx: CmdContext) =>
	Command.make("bench", {}, () =>
		Effect.gen(function* () {
			yield* Console.error(
				"eval bench: not yet wired — see packages/eval-adapter-local/scripts/bench " +
					"(gen-audio.py, bench-asr.py, wer.ts, BENCHMARK.md)",
			);
			return yield* new CommandExit({ code: 2 });
		}),
	).pipe(Command.withDescription("Not yet wired — see the bench scripts."));

#!/usr/bin/env bun
/**
 * eval — the composable eval framework CLI (P-074 phase 4).
 *
 * Composition root for the eval platform: discovers suite manifests
 * under evals/, resolves their contribution refs through the
 * ContributionRegistry built from the capability plugins' declared
 * contributions, and wires Effect Layers per adapter profile
 * (stub | local | cloud).
 *
 * NOTE on @effect/cli: evaluated and rejected — the published package
 * (0.77.x) peers effect@^3.22 while this repo is on effect@4.1.2, so
 * it cannot be a dependency. This is a plain Bun CLI with the same
 * command surface and strict argv validation (args.ts).
 *
 *   eval list [--dir d] [--strict]
 *   eval generate <suite> [--profile p] [--n N] [--workdir d] …
 *   eval run <suite> [--profile p] [--workdir d] [--run-id id] …
 *   eval gate <suite> [--workdir d] [--run-id id] [--enforce] …
 *   eval report <suite> [--workdir d] [--run-id id]
 *   eval bench            (not yet wired)
 *
 * Exit codes: 0 ok/report, 1 command failed or gate red under
 * --enforce, 2 usage error.
 */

import { pathToFileURL } from "node:url";
import * as path from "node:path";

import { UsageError } from "./args.ts";
import { benchCommand } from "./commands/bench.ts";
import { gateCommand } from "./commands/gate.ts";
import { generateCommand } from "./commands/generate.ts";
import { listCommand } from "./commands/list.ts";
import { reportCommand } from "./commands/report.ts";
import { runCommand } from "./commands/run.ts";
import { defaultContext, type CmdContext } from "./context.ts";

const HELP = `eval — composable eval framework CLI (P-074)

usage: eval <command> [args]

  list [--dir <evals>] [--strict]
      Scan suite manifests, validate, resolve contributions.
  generate <suite> [--profile stub|local|cloud] [--n N|--personas N]
      [--step N] [--seed N] [--workdir d] [--locale pt-BR]
      [--template name] [--noise clean|clinic|phone_bandpass|far_mic]
      [--concurrency N] [--run-id id]
      Persona matrix → script → TTS → dataset store.
  run <suite> [--profile p] [--workdir d] [--run-id id]
      [--limit N] [--concurrency N]
      transcribe → cleanup → judge over the stored cohort.
  gate <suite> [--workdir d] [--run-id id] [--enforce]
      [--stage asr|corrected] [--max-wer n] [--target n] [--min-n n]
      [--max-risk n] [--max-harmful-edits n] [--max-unjudged-edits n] [--z n]
      Apply the suite's declared gates to persisted results.
  report <suite> [--workdir d] [--run-id id]
      Render a run's markdown report + cohort summary.
  bench
      Not yet wired — see packages/eval-dataset-local/scripts/bench.

Profiles: stub (deterministic, zero cost) · local (edge-tts,
faster-whisper @ EVAL_ASR_URL, ACP @ EVAL_ACP_URL, Jev @ EVAL_JEV_URL)
· cloud (Workers AI ASR — needs EVAL_CF_ACCOUNT_ID/EVAL_CF_API_TOKEN/
EVAL_ASR_MODEL). Persistence is always sqlite+jsonl under --workdir.
`;

/** Dispatch one argv (without the leading command already split
 * out? No — argv includes the command name). Returns the process
 * exit code; never throws for expected failures. */
export const run = async (
	argv: readonly string[],
	ctx: CmdContext = defaultContext(),
): Promise<number> => {
	const [cmd, ...rest] = argv;
	try {
		switch (cmd) {
			case undefined:
			case "help":
			case "--help":
			case "-h":
				console.log(HELP);
				return cmd === undefined ? 2 : 0;
			case "list":
				return await listCommand(rest, ctx);
			case "generate":
				return await generateCommand(rest, ctx);
			case "run":
				return await runCommand(rest, ctx);
			case "gate":
				return await gateCommand(rest, ctx);
			case "report":
				return await reportCommand(rest, ctx);
			case "bench":
				return await benchCommand(rest, ctx);
			default:
				console.error(`eval: unknown command "${cmd}"\n\n${HELP}`);
				return 2;
		}
	} catch (e) {
		if (e instanceof UsageError) {
			console.error(`eval: ${e.message}`);
			return 2;
		}
		/* v8 ignore next -- every throw site in commands/args raises
		 * Error subclasses; String(e) is a type-level fallback */
		console.error(`eval: ${e instanceof Error ? e.message : String(e)}`);
		return 1;
	}
};

/* v8 ignore next -- argv[1] is always defined under vitest; the
 * undefined fallback only matters for exotic embedders */
const invokedAs =
	process.argv[1] === undefined ? "" : pathToFileURL(path.resolve(process.argv[1])).href;
/* v8 ignore next 3 -- entrypoint guard: only true when executed directly, never under vitest */
if (import.meta.url === invokedAs) {
	process.exit(await run(process.argv.slice(2)));
}

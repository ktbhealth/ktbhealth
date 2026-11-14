#!/usr/bin/env bun
/**
 * eval — the composable eval framework CLI.
 *
 * Composition root for the eval platform: discovers suite manifests
 * under evals/, resolves their contribution refs through the
 * ContributionRegistry collected from the eval plugins' manifest
 * `contributions` (P-070), and wires Effect Layers per adapter
 * profile (stub | local | cloud).
 *
 * CLI surface: `effect/cli` — the command framework that ships inside
 * effect@4 (the v4 successor of the standalone @effect/cli package,
 * which peers on effect@^3 and cannot be used here). Commands are
 * typed Flag/Argument configs with Effect handlers; parse failures
 * surface as CliError.ShowHelp and exit 2 via the teardown below,
 * domain failures as CliError.UserError (exit 1), and silent
 * non-zero verdicts as CommandExit.
 *
 *   eval list [--dir d] [--strict]
 *   eval generate <suite> [--profile p] [--n N] [--workdir d] …
 *   eval run <suite> [--profile p] [--workdir d] [--run-id id] …
 *   eval gate <suite> [--workdir d] [--run-id id] [--enforce] …
 *   eval report <suite> [--workdir d] [--run-id id]
 *   eval bench [--profile p] [--audio-dir d] [--models a,b,c] …
 *
 * Exit codes: 0 ok/report, 1 command failed or gate red under
 * --enforce, 2 usage error.
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";
import { Command, CliError } from "effect/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";

import { makeBenchCommand } from "./commands/bench.ts";
import { makeGateCommand } from "./commands/gate.ts";
import { makeGenerateCommand } from "./commands/generate.ts";
import { makeListCommand } from "./commands/list.ts";
import { makeReportCommand } from "./commands/report.ts";
import { makeRunCommand } from "./commands/run.ts";
import { defaultContext, type CmdContext } from "./context.ts";

const VERSION = "0.0.0";

/**
 * Process exit-code policy on top of Runtime.defaultTeardown:
 * ShowHelp carrying parse/validation errors is a usage error → 2
 * (the old CLI's contract); everything else keeps the default
 * (0 success, errorExitCode marker, 1 failure, 130 interrupt).
 */
export const teardown: Runtime.Teardown = (exit, onExit) => {
	if (Exit.isFailure(exit)) {
		const error = Cause.squash(exit.cause);
		if (CliError.isCliError(error) && error._tag === "ShowHelp" && error.errors.length > 0) {
			onExit(2);
			return;
		}
	}
	Runtime.defaultTeardown(exit, onExit);
};

/** Map a finished Exit to the process exit code — the testable half
 * of `teardown` (same policy, synchronous). */
export const exitCodeOf = (exit: Exit.Exit<unknown, unknown>): number => {
	let code = 0;
	teardown(exit, (c) => {
		code = c;
	});
	return code;
};

/** The full `eval` command tree bound to a command context. */
export const makeEvalCommand = (ctx: CmdContext) =>
	Command.make("eval", {}, () =>
		Effect.fail(
			new CliError.ShowHelp({
				commandPath: ["eval"],
				errors: [new CliError.MissingArgument({ argument: "<command>" })],
			}),
		),
	).pipe(
		Command.withSubcommands([
			makeListCommand(ctx),
			makeGenerateCommand(ctx),
			makeRunCommand(ctx),
			makeGateCommand(ctx),
			makeReportCommand(ctx),
			makeBenchCommand(ctx),
			Command.make("help", {}, () =>
				Effect.fail(new CliError.ShowHelp({ commandPath: ["eval"], errors: [] })),
			),
		]),
		Command.withDescription(
			"Composable eval framework CLI — suite manifests under evals/, adapter profiles stub|local|local-systemone|cloud.",
		),
	);

/**
 * Run the command tree against an explicit argv — the embedding/test
 * entry point. `layer` supplies the CLI Environment (FileSystem,
 * Path, Terminal, Stdio, ChildProcessSpawner); production uses
 * NodeServices via the entrypoint below.
 */
export const run = (
	argv: readonly string[],
	ctx: CmdContext = defaultContext(),
	layer: Layer.Layer<Command.Environment> = NodeServices.layer,
): Promise<number> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Command.runWith(makeEvalCommand(ctx), { version: VERSION })(argv),
			);
			return exitCodeOf(exit);
		}).pipe(Effect.provide(layer)),
	);

/* v8 ignore next -- argv[1] is always defined under vitest; the
 * undefined fallback only matters for exotic embedders */
const invokedAs =
	process.argv[1] === undefined ? "" : pathToFileURL(path.resolve(process.argv[1])).href;
/* v8 ignore next 3 -- entrypoint guard: only true when executed directly, never under vitest */
if (import.meta.url === invokedAs) {
	NodeRuntime.runMain(
		Command.run(makeEvalCommand(defaultContext()), { version: VERSION }).pipe(
			Effect.provide(NodeServices.layer),
		),
		{ teardown },
	);
}

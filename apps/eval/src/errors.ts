/**
 * errors.ts — CLI error channel (effect/cli migration).
 *
 * Two failure shapes cover every exit code the eval CLI produces:
 *
 * - `UsageError` — bad argv or invalid flag values discovered inside a
 *   handler (unknown --profile, non-scratch --workdir, bad --noise).
 *   Rendered by `Command.run` through `CliError.userMessage` and
 *   mapped to exit 2 by the teardown in cli.ts — the same contract
 *   the old args.ts UsageError had.
 * - `CommandExit` — the command did its work but must exit non-zero
 *   (failed batch outcomes, a red gate under --enforce). Already
 *   reported on stdout, so `errorReported` is false and only the
 *   `[Runtime.errorExitCode]` marker reaches the process exit code.
 */

import { Schema } from "effect";
import { CliError } from "effect/cli";
import * as Runtime from "effect/Runtime";

/** Bad argv/flag value — rendered as a user error, exit 2. */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", {
	message: Schema.String,
}) {
	get [CliError.userMessage]() {
		return this.message;
	}

	get [Runtime.errorExitCode]() {
		return 2;
	}
}

/** Silent non-zero exit — the command already printed its verdict. */
export class CommandExit extends Schema.TaggedError<CommandExit>()("CommandExit", {
	code: Schema.Int,
}) {
	readonly [Runtime.errorReported] = false;

	get [Runtime.errorExitCode]() {
		return this.code;
	}
}

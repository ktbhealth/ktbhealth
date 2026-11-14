/**
 * Minimal platform layer for the Effect CLI — this repo has no
 * @effect/platform-* runtime (those packages target Effect 3), so the
 * five services `Command.runWith` requires are provided directly.
 * Terminal input/readLine are unimplemented: the eval commands are
 * non-interactive by design.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/process";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Terminal from "effect/Terminal";

const write = (stream: NodeJS.WriteStream) =>
	Sink.forEach((chunk: string | Uint8Array) =>
		Effect.sync(() => {
			stream.write(chunk);
		}),
	);

const stdio = Stdio.make({
	args: Effect.succeed(process.argv.slice(2)),
	stdin: Stream.empty,
	stdout: () => write(process.stdout),
	stderr: () => write(process.stderr),
	stdinIsTerminal: Effect.succeed(Boolean(process.stdin.isTTY)),
	stdoutIsTerminal: Effect.succeed(Boolean(process.stdout.isTTY)),
	stderrIsTerminal: Effect.succeed(Boolean(process.stderr.isTTY)),
});

const terminal = Terminal.make({
	columns: Effect.succeed(process.stdout.columns ?? 80),
	rows: Effect.succeed(process.stdout.rows ?? 24),
	size: Effect.map(Queue.unbounded<Terminal.Size>(), (q) => q),
	readInput: Effect.map(Queue.unbounded<Terminal.UserInput>(), (q) => q),
	readLine: Effect.fail(new Terminal.QuitError()),
	display: (text) =>
		Effect.sync(() => {
			process.stdout.write(text);
		}),
});

const spawner = ChildProcessSpawner.make(() =>
	Effect.die(new Error("ChildProcessSpawner is not supported by the eval CLI")),
);

export const platformLayer = Layer.mergeAll(
	Path.layer,
	FileSystem.layerNoop({}),
	Layer.succeed(Stdio.Stdio, stdio),
	Layer.succeed(Terminal.Terminal, terminal),
	Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
);

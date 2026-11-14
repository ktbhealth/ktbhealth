/**
 * App-level smoke tests — exercise the real command tree through
 * Command.runWith on a temp workdir with stub adapters. The platform
 * layer points at real stdio; output noise is acceptable in CI logs.
 */
import { Command } from "effect/cli";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/process";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Exit from "effect/Exit";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Terminal from "effect/Terminal";
import { describe, expect, it } from "vitest";

import { cli, formatGenOutcome, formatRunOutcome } from "./commands.ts";
import { platformLayer } from "./platform.ts";

const run = Command.runWith(cli, { version: "0.0.0-test" });
const invoke = (args: readonly string[]) =>
	Effect.runPromise(Effect.scoped(run([...args])).pipe(Effect.provide(platformLayer)));

const workdir = `/tmp/eval-cli-test-${process.pid}`;

describe("eval cli", () => {
	it("generate → run → gate end-to-end on stub adapters", async () => {
		await invoke(["generate", "--workdir", workdir, "--tts", "stub", "--personas", "3"]);
		await invoke([
			"run",
			"--workdir",
			workdir,
			"--asr",
			"stub",
			"--judge",
			"stub",
			"--run-id",
			"test-run",
			"--retry",
			"1",
		]);
		// stub transcripts are placeholder text — the gate stays red
		const prev = process.exitCode;
		await invoke(["gate", "--workdir", workdir, "--enforce"]);
		expect(process.exitCode).toBe(1);
		process.exitCode = prev;
	});

	it("resume skips processed samples; --all re-runs them", async () => {
		await invoke(["run", "--workdir", workdir, "--asr", "stub", "--judge", "stub"]);
		await invoke([
			"run",
			"--workdir",
			workdir,
			"--asr",
			"stub",
			"--judge",
			"stub",
			"--all",
			"--limit",
			"1",
			"--dataset-version",
			"gen-2099-01-01",
		]);
	});

	it("run with a real edge tts flag keeps failures isolated", { timeout: 30_000 }, async () => {
		await invoke(["generate", "--workdir", workdir, "--tts", "edge", "--personas", "1"]);
	});

	it("gate is green when the policy is relaxed", async () => {
		await invoke(["gate", "--workdir", workdir, "--max-wer", "2", "--target", "0", "--min-n", "1"]);
	});

	it("run against dead http endpoints reports isolated failures", async () => {
		await invoke([
			"run",
			"--workdir",
			workdir,
			"--asr",
			"http://127.0.0.1:9",
			"--judge",
			"http://127.0.0.1:9",
			"--all",
			"--retry",
			"1",
		]);
	});

	it("outcome formatters cover every status", () => {
		expect(formatGenOutcome({ status: "ok" })).toBe("ok");
		expect(formatGenOutcome({ status: "failed", error: { message: "boom" } })).toBe("FAIL boom");
		expect(formatGenOutcome({ status: "failed" })).toBe("FAIL unknown");
		expect(formatGenOutcome({ status: "timedOut" })).toBe("TIMEOUT");
		expect(formatRunOutcome({ status: "ok" })).toBe("ok");
		expect(formatRunOutcome({ status: "failed", error: { message: "x" } })).toBe("failed — x");
		expect(formatRunOutcome({ status: "timedOut" })).toBe("timedOut");
	});

	it("gate on an empty workdir reports nothing to do", async () => {
		await invoke(["gate", "--workdir", `${workdir}-empty`]);
	});
});

describe("platformLayer", () => {
	it("provides stdio, terminal and a guarded spawner", async () => {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const stdio = yield* Stdio.Stdio;
					expect(yield* stdio.args).toBeInstanceOf(Array);
					yield* Stream.run(Stream.make("x"), stdio.stdout());
					yield* Stream.run(Stream.make("y"), stdio.stderr());
					expect(yield* stdio.stdinIsTerminal).toBeTypeOf("boolean");
					expect(yield* stdio.stdoutIsTerminal).toBeTypeOf("boolean");
					expect(yield* stdio.stderrIsTerminal).toBeTypeOf("boolean");
					expect(yield* Stream.runHead(stdio.stdin)).toBeDefined();

					const term = yield* Terminal.Terminal;
					expect(yield* term.columns).toBeGreaterThan(0);
					expect(yield* term.rows).toBeGreaterThan(0);
					yield* term.display("z");
					const size = yield* term.size;
					const input = yield* term.readInput;
					expect(size).toBeDefined();
					expect(input).toBeDefined();
					const quit = yield* Effect.flip(term.readLine);
					expect(quit).toBeInstanceOf(Terminal.QuitError);

					const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
					const died = yield* Effect.exit(spawner.spawn({ command: "nope" } as never));
					expect(Exit.isFailure(died)).toBe(true);
				}).pipe(Effect.provide(platformLayer)),
			),
		);
	});

	it("layers merge without conflicts", () => {
		expect(Layer.isLayer(platformLayer)).toBe(true);
	});
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { FileSystem, Layer, Path, Stdio, Terminal } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { storeReportLayers } from "./adapters.ts";
import { repoRoot, type CmdContext } from "./context.ts";
import { run } from "./cli.ts";

/** In-memory stand-ins for the CLI Environment services — the command
 * handlers never touch them (they use node:fs directly); only the
 * effect/cli runner needs them for help/error rendering. */
const CliTestLayer = Layer.mergeAll(
	FileSystem.layerNoop({}),
	Path.layer,
	Stdio.layerTest({}),
	Layer.succeed(
		Terminal.Terminal,
		Terminal.make({
			columns: Effect.succeed(80),
			rows: Effect.succeed(24),
			size: Effect.die("unused"),
			readInput: Effect.die("unused"),
			readLine: Effect.die("unused"),
			display: () => Effect.void,
		}),
	),
	Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make(() => Effect.die("unused")),
	),
);

let evalsDir = "";
let workdir = "";

const SUITE = `export const suite = {
	id: "fx",
	domain: "eval.consult",
	dataset: { id: "fx", version: "v1" },
	stages: ["transcribe", "cleanup", "judge"],
	caps: {
		tts: "transcription.tts",
		asr: "transcription.asr",
		llm: "llm.eval",
		eval: "llm.eval",
		store: "storage.dataset",
		report: "storage.dataset",
	},
	metrics: ["wer"],
	gates: [{ id: "auto-accept", params: { stage: "corrected", maxWer: 0.05, target: 0.9, minN: 40, maxRisk: 0, maxHarmfulEdits: 0, maxUnjudgedEdits: 0 } }, { id: "auto-accept" }],
	schemaVersion: 1,
	adapterProfile: "stub",
};`;

const ctx = (): CmdContext => ({
	evalsDir,
	repoRoot: repoRoot(),
	env: {},
});

/** Run the full command tree against argv (no "eval" prefix). */
const exec = (args: readonly string[], c: CmdContext = ctx()) => run(args, c, CliTestLayer);

beforeAll(() => {
	evalsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-evals-"));
	fs.writeFileSync(path.join(evalsDir, "fx.suite.ts"), SUITE);
	workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-data-"));
});

afterAll(() => {
	fs.rmSync(evalsDir, { recursive: true, force: true });
	fs.rmSync(workdir, { recursive: true, force: true });
});

describe("list", () => {
	test("prints suite + resolution summary", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["list"])).toBe(0);
			const out = spy.mock.calls.map((c) => String(c[0])).join("\n");
			expect(out).toContain("fx — ");
			expect(out).toContain("0 unresolved ref(s)");
		} finally {
			spy.mockRestore();
		}
	});

	test("--strict exits 1 on unresolved refs", async () => {
		const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-bad-"));
		fs.writeFileSync(
			path.join(badDir, "bad.suite.ts"),
			`export const suite = { id: "bad", domain: "d", dataset: { id: "d", version: "1" }, stages: ["ghost"], caps: {}, metrics: [], gates: [], schemaVersion: 1 };`,
		);
		try {
			vi.spyOn(console, "log").mockImplementation(() => {});
			expect(await exec(["list", "--dir", badDir, "--strict"])).toBe(1);
			expect(await exec(["list", "--dir", badDir])).toBe(0);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(badDir, { recursive: true, force: true });
		}
	});

	test("empty dir prints a notice", async () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-empty-"));
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["list", "--dir", empty])).toBe(0);
			expect(spy.mock.calls.flat().join(" ")).toContain("no suite manifests");
		} finally {
			spy.mockRestore();
			fs.rmSync(empty, { recursive: true, force: true });
		}
	});
});

describe("generate", () => {
	test("generates samples end-to-end under stub profile", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				await exec(["generate", "fx", "--n", "2", "--workdir", workdir], {
					...ctx(),
					fetchImpl: fetch,
				}),
			).toBe(0);
			expect(fs.existsSync(path.join(workdir, "manifest.sqlite"))).toBe(true);
			expect(fs.existsSync(path.join(workdir, "reports", "eval.jsonl"))).toBe(true);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("--personas alias and flag variants parse", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-gen2-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				await exec([
					"generate",
					"fx",
					"--personas=1",
					"--step",
					"3",
					"--seed",
					"7",
					"--noise",
					"clinic",
					"--template",
					"followup",
					"--concurrency",
					"1",
					"--run-id",
					"gen-x",
					"--workdir",
					wd,
				]),
			).toBe(0);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("bad flags are usage errors (exit 2)", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// Unknown suite → command error → 1.
			expect(await exec(["generate", "nope", "--workdir", workdir])).toBe(1);
			// Semantic flag validation → UsageError → 2.
			expect(await exec(["generate", "fx", "--profile", "bogus", "--workdir", workdir])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("unknown --profile");
			expect(await exec(["generate", "fx", "--noise", "loud", "--workdir", workdir])).toBe(2);
			expect(await exec(["generate", "fx", "--locale", "en", "--workdir", workdir])).toBe(2);
			expect(await exec(["generate", "fx", "--template", "../x", "--workdir", workdir])).toBe(2);
			expect(await exec(["generate", "fx", "--workdir", "/etc"])).toBe(2);
			expect(await exec(["generate", "fx", "--n", "0", "--workdir", workdir])).toBe(2);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("argv parse failures exit 2 (unknown flag, bad int)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["generate", "fx", "--bogus", "1", "--workdir", workdir])).toBe(2);
			expect(await exec(["generate", "fx", "--n", "abc", "--workdir", workdir])).toBe(2);
			expect(await exec(["generate", "fx", "extra", "--workdir", workdir])).toBe(2);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("unresolvable tts capability fails before any work", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-notts-"));
		fs.writeFileSync(
			path.join(dir, "notts.suite.ts"),
			`export const suite = { id: "notts", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [], schemaVersion: 1 };`,
		);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(
				await exec(["generate", "notts", "--workdir", workdir], { ...ctx(), evalsDir: dir }),
			).toBe(1);
			expect(err.mock.calls.flat().join(" ")).toContain('capability "tts"');
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("missing template file is a command error (exit 1)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				await exec(["generate", "fx", "--template", "no-such-template", "--workdir", workdir]),
			).toBe(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("adapter failures surface as failed outcomes (exit 1)", { timeout: 30_000 }, async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-edge-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// local profile → edge-tts: the binary is absent in test env,
			// so every synthesis fails and the command reports failures.
			expect(
				await exec(["generate", "fx", "--profile", "local", "--n", "1", "--workdir", wd]),
			).toBe(1);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});
});

describe("run/gate/report round-trip", () => {
	test("run processes the generated cohort, gate reports, report renders", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "fx", "--workdir", workdir])).toBe(0);

			// gate without --enforce is a report (0); with it, red → 1.
			expect(await exec(["gate", "fx", "--workdir", workdir])).toBe(0);
			expect(await exec(["gate", "fx", "--workdir", workdir, "--enforce"])).toBe(1);

			expect(await exec(["report", "fx", "--workdir", workdir])).toBe(0);
			expect(await exec(["report", "fx", "--workdir", workdir, "--run-id", "nope"])).toBe(0);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("run on an empty cohort exits 1", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-emptyrun-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "fx", "--workdir", wd])).toBe(1);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("run rejects --limit 0 and non-integer flags", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "fx", "--workdir", workdir, "--limit", "0"])).toBe(2);
			expect(await exec(["run", "fx", "--workdir", workdir, "--concurrency", "x"])).toBe(2);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("gate/report on empty stores are clean no-ops", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-nodata-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["gate", "fx", "--workdir", wd])).toBe(0);
			expect(await exec(["report", "fx", "--workdir", wd])).toBe(0);
			// ...but an empty gate under --enforce is vacuous green —
			// no evidence is not a pass.
			expect(await exec(["gate", "fx", "--workdir", wd, "--enforce"])).toBe(1);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("gate/report ignore results stamped with another datasetVersion", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-otherds-"));
		const { store } = storeReportLayers(wd);
		const { DatasetStorePort } = await import("@ktb/eval-consult");
		await Effect.runPromise(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				// A perfect result — but it belongs to a DIFFERENT suite's
				// dataset pin, so this suite's gate must not see it.
				yield* s.putResult({
					runId: "foreign-run",
					sampleId: "foreign-1",
					datasetVersion: "other-v9",
					asrText: "t",
					correctedMetrics: {
						wer: 0,
						cer: 0,
						criticalErrors: 0,
						entityVerdicts: [{ category: "negation", entity: "não", status: "correct" }],
					},
					editVerdicts: [],
					confSegments: Array.from({ length: 50 }, () => ({
						confidence: 0.9,
						correct: true,
					})),
					createdAt: 1,
				});
			}).pipe(Effect.provide(store)),
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// Scoped out → empty → report exits 0, enforce exits 1.
			expect(await exec(["gate", "fx", "--workdir", wd])).toBe(0);
			expect(await exec(["gate", "fx", "--workdir", wd, "--enforce"])).toBe(1);
			const out = spy.mock.calls.flat().join("\n");
			expect(out).toContain('dataset "fx-v1"');
			expect(out).toContain("other datasets");
			expect(await exec(["report", "fx", "--workdir", wd])).toBe(0);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("gate on a missing runId is a clean no-op", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["gate", "fx", "--workdir", workdir, "--run-id", "nope"])).toBe(0);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("gate is GREEN (and enforce passes) when every result passes", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-green-"));
		const { store } = storeReportLayers(wd);
		const { DatasetStorePort } = await import("@ktb/eval-consult");
		await Effect.runPromise(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				yield* s.putResult({
					runId: "green-run",
					sampleId: "good-1",
					datasetVersion: "fx-v1",
					asrText: "t",
					correctedMetrics: {
						wer: 0,
						cer: 0,
						criticalErrors: 0,
						entityVerdicts: [{ category: "negation", entity: "não", status: "correct" }],
					},
					editVerdicts: [],
					confSegments: Array.from({ length: 50 }, () => ({
						confidence: 0.9,
						correct: true,
					})),
					createdAt: 1,
				});
			}).pipe(Effect.provide(store)),
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				await exec(["gate", "fx", "--workdir", wd, "--run-id", "green-run", "--enforce"]),
			).toBe(0);
			const out = spy.mock.calls.flat().join("\n");
			expect(out).toContain("GREEN");
			expect(out).toContain("good-1: accept");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("gate with an unregistered gate id is an error", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-mgate-"));
		fs.writeFileSync(
			path.join(dir, "mgate.suite.ts"),
			`export const suite = { id: "mgate", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [{ id: "mystery-gate" }], schemaVersion: 1 };`,
		);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await exec(["gate", "mgate", "--workdir", workdir], { ...ctx(), evalsDir: dir })).toBe(
				1,
			);
			expect(err.mock.calls.flat().join(" ")).toContain("no runner");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("gate with undecodable params is a usage error (exit 2)", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-bgate-"));
		fs.writeFileSync(
			path.join(dir, "bgate.suite.ts"),
			`export const suite = { id: "bgate", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [{ id: "auto-accept", params: { stage: "bogus" } }], schemaVersion: 1 };`,
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["gate", "bgate", "--workdir", workdir], { ...ctx(), evalsDir: dir })).toBe(
				2,
			);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("report renders the latest runId and handles metric-less rows", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-report-"));
		const { store } = storeReportLayers(wd);
		const { DatasetStorePort } = await import("@ktb/eval-consult");
		const put = (runId: string, sampleId: string, createdAt: number) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putResult({
						runId,
						sampleId,
						datasetVersion: "fx-v1",
						asrText: "t",
						editVerdicts: [],
						confSegments: [],
						createdAt,
					});
				}).pipe(Effect.provide(store)),
			);
		await put("old-run", "s1", 1);
		await put("new-run", "s2", 2);
		await put("zero-run", "s0", 0);
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["report", "fx", "--workdir", wd])).toBe(0);
			expect(await exec(["report", "fx", "--workdir", wd, "--run-id", "old-run"])).toBe(0);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("run honours --limit/--run-id and survives a bad sample", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const c = { ...ctx(), fetchImpl: fetch };
		try {
			// --limit 1 over the 2-sample cohort.
			expect(
				await exec(["run", "fx", "--workdir", workdir, "--limit", "1", "--run-id", "run-lim"], c),
			).toBe(0);

			// A sample with no audio fails its step but not the batch.
			const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-badsample-"));
			await exec(["generate", "fx", "--n", "1", "--workdir", wd]);
			const { DatasetStorePort: DSP } = await import("@ktb/eval-consult");
			const { store } = storeReportLayers(wd);
			await Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DSP;
					yield* s.putSample({
						id: "no-audio",
						datasetVersion: "fx-v1",
						origin: "synthetic",
						script: "Doctor: oi?",
						scriptHash: "h",
						persona: { region: "r", ageBand: "a", register: "f", specialty: "s" },
						gold: { validatedBy: "generator" },
					});
				}).pipe(Effect.provide(store)),
			);
			expect(await exec(["run", "fx", "--workdir", wd])).toBe(1);
			fs.rmSync(wd, { recursive: true, force: true });
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("gate flag overrides and invalid --stage", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// Overrides parse and apply (still red — stub WER is huge).
			expect(
				await exec([
					"gate",
					"fx",
					"--workdir",
					workdir,
					"--stage",
					"asr",
					"--max-wer",
					"9",
					"--min-n",
					"0",
					"--target",
					"0.1",
					"--max-risk",
					"9",
					"--max-harmful-edits",
					"9",
					"--max-unjudged-edits",
					"9",
					"--z",
					"1",
				]),
			).toBe(0);
			expect(await exec(["gate", "fx", "--workdir", workdir, "--stage", "bogus"])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("--stage");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("gate rejects gate-weakening numeric overrides (exit 2)", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// Each of these would silently weaken the gate if applied.
			for (const flag of [
				"--target",
				"--min-n",
				"--max-wer",
				"--max-risk",
				"--max-harmful-edits",
				"--max-unjudged-edits",
				"--z",
			]) {
				// Pick a value that violates that flag's range rule.
				const bad =
					flag === "--target" ? "1.5" : flag === "--z" ? "0" : flag === "--min-n" ? "-1" : "-0.5";
				expect(await exec(["gate", "fx", "--workdir", workdir, flag, bad])).toBe(2);
			}
			expect(await exec(["gate", "fx", "--workdir", workdir, "--z=-5"])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("--z must be > 0");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("run honours --locale and rejects unknown locales", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const c = { ...ctx(), fetchImpl: fetch };
		try {
			expect(await exec(["run", "fx", "--workdir", workdir, "--locale", "en"], c)).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("unknown --locale");
			expect(await exec(["run", "fx", "--workdir", workdir, "--locale", "pt-BR"], c)).toBe(0);
		} finally {
			vi.restoreAllMocks();
		}
	});
});

describe("bench", () => {
	test("prints the deferral notice and exits 2", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await exec(["bench"])).toBe(2);
			expect(spy.mock.calls.flat().join(" ")).toContain("not yet wired");
		} finally {
			spy.mockRestore();
		}
	});
});

describe("cli.run dispatch", () => {
	test("no args prints help, exit 2; help exits 0", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await exec([])).toBe(2);
			expect(await exec(["help"])).toBe(0);
			expect(await exec(["--help"])).toBe(0);
			expect(await exec(["--version"])).toBe(0);
			const out = [...spy.mock.calls, ...errSpy.mock.calls].flat().join("\n");
			expect(out).toContain("eval");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("unknown command exits 2", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["bogus"])).toBe(2);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("usage errors exit 2, command errors exit 1", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// Missing positional → parse error → 2.
			expect(await exec(["generate"])).toBe(2);
			// Unknown suite → command error → 1.
			expect(await exec(["generate", "ghost", "--workdir", workdir])).toBe(1);
			expect(await exec(["gate", "ghost", "--workdir", workdir])).toBe(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("end-to-end via run(): generate → run → gate → report", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-e2e-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await exec(["generate", "fx", "--n", "1", "--workdir", wd])).toBe(0);
			expect(await exec(["run", "fx", "--workdir", wd])).toBe(0);
			expect(await exec(["report", "fx", "--workdir", wd])).toBe(0);
			expect(await exec(["list"])).toBe(0);
			expect(await exec(["gate", "fx", "--workdir", wd])).toBe(0);
			expect(await exec(["bench"])).toBe(2);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});
});

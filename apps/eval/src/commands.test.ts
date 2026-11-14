import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { FileSystem, Layer, Path, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { storeReportLayers } from "./adapters.ts";
import { repoRoot, type CmdContext } from "./context.ts";
import { exitCodeOf, run } from "./cli.ts";
import { makeBenchCommand, nodeSpawn, type BenchSpawn } from "./commands/bench.ts";

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

/** Same dataset pin as SUITE but WITHOUT the judge stage — exercises
 * manifest stage dispatch (transcribe + cleanup only). */
const SUITE_NOJUDGE = SUITE.replace(
	'stages: ["transcribe", "cleanup", "judge"]',
	'stages: ["script_gen", "synthesize", "transcribe", "cleanup"]',
).replace('id: "fx"', 'id: "fx-nojudge"');

/** Out-of-order run stages — a manifest bug run must reject. */
const SUITE_BADORDER = SUITE.replace(
	'stages: ["transcribe", "cleanup", "judge"]',
	'stages: ["cleanup", "transcribe"]',
).replace('id: "fx"', 'id: "fx-badorder"');

/** Transcribe-only selection — no corrected stage at all. */
const SUITE_ASR = SUITE.replace(
	'stages: ["transcribe", "cleanup", "judge"]',
	'stages: ["script_gen", "synthesize", "transcribe"]',
).replace('id: "fx"', 'id: "fx-asr"');

beforeAll(() => {
	evalsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-evals-"));
	fs.writeFileSync(path.join(evalsDir, "fx.suite.ts"), SUITE);
	fs.writeFileSync(path.join(evalsDir, "fx-nojudge.suite.ts"), SUITE_NOJUDGE);
	fs.writeFileSync(path.join(evalsDir, "fx-badorder.suite.ts"), SUITE_BADORDER);
	fs.writeFileSync(path.join(evalsDir, "fx-asr.suite.ts"), SUITE_ASR);
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
		const { DatasetStorePort } = await import("@ktb/eval-consultation");
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
		const { DatasetStorePort } = await import("@ktb/eval-consultation");
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
		const { DatasetStorePort } = await import("@ktb/eval-consultation");
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
			const { DatasetStorePort: DSP } = await import("@ktb/eval-consultation");
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

describe("stage dispatch", () => {
	test("a manifest without the judge stage runs transcribe+cleanup only", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const c = { ...ctx(), fetchImpl: fetch };
		try {
			// Same dataset pin as fx — the cohort generated earlier is
			// shared; only the stage selection differs.
			expect(await exec(["run", "fx-nojudge", "--workdir", workdir, "--run-id", "run-nj"], c)).toBe(
				0,
			);
			const { store } = storeReportLayers(workdir);
			const { DatasetStorePort } = await import("@ktb/eval-consultation");
			const results = await Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					return yield* s.listResults({ runId: "run-nj" });
				}).pipe(Effect.provide(store)),
			);
			expect(results.length).toBeGreaterThan(0);
			for (const r of results) {
				expect(r.correctedText).toBeDefined();
				// Judge never ran → floor verdicts + unjudged edits.
				expect(r.correctedMetrics?.entityVerdicts.every((v) => v.source === "text_floor")).toBe(
					true,
				);
				expect(r.editVerdicts.every((v) => v.classification === "unjudged")).toBe(true);
			}
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("a transcribe-only manifest persists asr-only results", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const c = { ...ctx(), fetchImpl: fetch };
		try {
			expect(await exec(["run", "fx-asr", "--workdir", workdir, "--run-id", "run-asr"], c)).toBe(0);
			const out = spy.mock.calls.flat().join("\n");
			expect(out).toContain("no corrected stage");
			const { store } = storeReportLayers(workdir);
			const { DatasetStorePort } = await import("@ktb/eval-consultation");
			const results = await Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					return yield* s.listResults({ runId: "run-asr" });
				}).pipe(Effect.provide(store)),
			);
			expect(results.length).toBeGreaterThan(0);
			for (const r of results) {
				expect(r.asrMetrics).toBeDefined();
				expect(r.correctedMetrics).toBeUndefined();
				expect(r.correctedText).toBeUndefined();
				expect(r.edits).toBeUndefined();
			}
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("out-of-order and unrunnable stage selections fail before the batch", async () => {
		// fx-unrunnable lives in its own evals dir: its stage id is
		// unregistered, which would pollute the shared dir's
		// `eval list` unresolved count.
		const unrunnableDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-unrun-"));
		fs.writeFileSync(
			path.join(unrunnableDir, "fx-unrunnable.suite.ts"),
			SUITE.replace(
				'stages: ["transcribe", "cleanup", "judge"]',
				'stages: ["transcribe", "mystery-stage"]',
			).replace('id: "fx"', 'id: "fx-unrunnable"'),
		);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "fx-badorder", "--workdir", workdir])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("out of order");
			expect(
				await exec(["run", "fx-unrunnable", "--workdir", workdir], {
					...ctx(),
					evalsDir: unrunnableDir,
				}),
			).toBe(1);
			expect(err.mock.calls.flat().join(" ")).toContain("no eval-run runner");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(unrunnableDir, { recursive: true, force: true });
		}
	});
});

interface SpawnCall {
	readonly file: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string | undefined>>;
}

const okResult = { status: 0, stdout: "", stderr: "" };

/** Spawn fake that satisfies every bench step without touching the
 * network: import checks + ffmpeg pass, gen-audio.py materializes
 * fixtures into BENCH_AUDIO_DIR, bench-asr.py writes `results` to
 * BENCH_RESULTS. */
const benchSpawn = (
	calls: SpawnCall[],
	fixture: { wav: string; txt: string },
	results: unknown,
): BenchSpawn => {
	return (file, args, env) => {
		calls.push({ file, args, env });
		const script = args[0] ?? "";
		if (script.endsWith("gen-audio.py")) {
			// gen-audio.py does OUT.mkdir(parents=True) — mirror it.
			fs.mkdirSync(env.BENCH_AUDIO_DIR!, { recursive: true });
			fs.writeFileSync(path.join(env.BENCH_AUDIO_DIR!, fixture.wav), "x");
			fs.writeFileSync(path.join(env.BENCH_AUDIO_DIR!, fixture.txt), "gold text");
			return okResult;
		}
		if (script.endsWith("bench-asr.py")) {
			fs.writeFileSync(env.BENCH_RESULTS!, JSON.stringify(results));
			return okResult;
		}
		return okResult;
	};
};

/** Run the bench command alone (argv = its own flags) with an
 * injected spawn — same runner/teardown as cli.run. */
const execBench = (
	args: readonly string[],
	spawn: BenchSpawn,
	c: CmdContext = ctx(),
): Promise<number> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Command.runWith(makeBenchCommand(c, spawn), { version: "0" })(args),
			);
			return exitCodeOf(exit);
		}).pipe(Effect.provide(CliTestLayer)),
	);

const benchDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "eval-bench-"));

describe("bench", () => {
	test("scores fixtures end-to-end with an injected spawn", async () => {
		const dir = benchDir();
		fs.writeFileSync(path.join(dir, "s0.wav"), "x");
		fs.writeFileSync(path.join(dir, "s0.txt"), "o paciente nega febre");
		const results = path.join(dir, "results.json");
		const calls: SpawnCall[] = [];
		const spawn = benchSpawn(calls, { wav: "s0.wav", txt: "s0.txt" }, [
			{ model: "tiny", rtf: 0.1, peak_rss_mb: 100, hyps: ["o paciente nega febre"] },
			{ model: "base", rtf: 0.2, peak_rss_mb: 200, load_s: 1.5, hyps: ["paciente febre"] },
		]);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await execBench(["--audio-dir", dir, "--results", results], spawn)).toBe(0);
			const out = spy.mock.calls.flat().join("\n");
			expect(out).toContain("=== tiny");
			expect(out).toContain("mean WER=0.000");
			expect(out).toContain('s0: wer=0.00  "o paciente nega febre"');
			expect(out).toContain("load=1.5s");
			expect(out).toContain("load=-");
			// bench-asr.py got the audio/results env contract.
			const sweep = calls.find((c) => c.args[0]?.endsWith("bench-asr.py"));
			expect(sweep?.env.BENCH_AUDIO_DIR).toBe(dir);
			expect(sweep?.env.BENCH_RESULTS).toBe(results);
			expect(sweep?.args.slice(1)).toEqual(["tiny", "base", "small"]);
		} finally {
			spy.mockRestore();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("committed fixtures + results score with default paths", async () => {
		// No --audio-dir/--results: the real scripts/bench fixtures and
		// asr-results.json are used; the fake spawn only has to not
		// fail — scoring reads the committed JSON.
		const spawn: BenchSpawn = () => okResult;
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await execBench([], spawn)).toBe(0);
			const out = spy.mock.calls.flat().join("\n");
			expect(out).toContain("=== turbo");
			expect(out).toContain("mean WER=");
		} finally {
			spy.mockRestore();
		}
	});

	test("python selection: flag > EVAL_BENCH_PYTHON > python3", async () => {
		const dir = benchDir();
		fs.writeFileSync(path.join(dir, "s0.wav"), "x");
		fs.writeFileSync(path.join(dir, "s0.txt"), "gold");
		const results = path.join(dir, "results.json");
		const gold = [{ model: "m", rtf: 0, peak_rss_mb: 0, hyps: ["gold"] }];
		const run1 = async (extra: readonly string[], env: Record<string, string> = {}) => {
			const calls: SpawnCall[] = [];
			const c: CmdContext = { ...ctx(), env };
			await execBench(
				[...extra, "--audio-dir", dir, "--results", results],
				benchSpawn(calls, { wav: "s0.wav", txt: "s0.txt" }, gold),
				c,
			);
			return calls.find((x) => x.args[0] === "-c")?.file;
		};
		try {
			expect(await run1(["--python", "py3.12"])).toBe("py3.12");
			expect(await run1([], { EVAL_BENCH_PYTHON: "envpy" })).toBe("envpy");
			expect(await run1([])).toBe("python3");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("--profile is validated; only local profiles apply", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await execBench(["--profile", "bogus"], nodeSpawn)).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("unknown --profile");
			expect(await execBench(["--profile", "stub"], nodeSpawn)).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("only applies to local profiles");
			// local + local-systemone pass validation (then fail on
			// missing python in this env — either way not a usage error).
			for (const p of ["local", "local-systemone"]) {
				const code = await execBench(
					["--profile", p, "--python", "definitely-missing-py-xyz"],
					nodeSpawn,
				);
				expect(code).toBe(1);
			}
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("--models must name at least one model", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await execBench(["--models", " , "], nodeSpawn)).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("--models");
		} finally {
			err.mockRestore();
		}
	});

	test("fixture regeneration path: edge-tts + ffmpeg + gen-audio.py", async () => {
		const dir = benchDir();
		const audio = path.join(dir, "audio"); // does not exist yet
		const results = path.join(dir, "results.json");
		const calls: SpawnCall[] = [];
		const spawn = benchSpawn(calls, { wav: "s0.wav", txt: "s0.txt" }, [
			{ model: "m", rtf: 0, peak_rss_mb: 0, hyps: ["gold text"] },
		]);
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// --regen-audio forces the path even though… fixtures absent anyway.
			expect(
				await execBench(["--audio-dir", audio, "--results", results, "--regen-audio"], spawn),
			).toBe(0);
			const files = calls.map((c) => c.file);
			expect(files).toContain("ffmpeg");
			expect(calls.some((c) => c.args[0] === "-c" && c.args[1] === "import edge_tts")).toBe(true);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("regen failures name the missing piece", async () => {
		const dir = benchDir();
		const audio = path.join(dir, "audio");
		const results = path.join(dir, "results.json");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const spawnWhere =
			(
				pick: (file: string, args: readonly string[]) => boolean,
				result: { status: number | null; stdout?: string; stderr?: string; error?: string },
			): BenchSpawn =>
			(file, args) =>
				pick(file, args)
					? {
							status: result.status,
							stdout: result.stdout ?? "",
							stderr: result.stderr ?? "",
							...(result.error !== undefined ? { error: result.error } : {}),
						}
					: okResult;
		try {
			// edge-tts import fails.
			expect(
				await execBench(
					["--audio-dir", audio, "--results", results],
					spawnWhere((f, a) => a[0] === "-c", { status: 1, stderr: "ModuleNotFoundError" }),
				),
			).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("edge-tts");
			// ffmpeg missing.
			expect(
				await execBench(
					["--audio-dir", audio, "--results", results],
					spawnWhere((f) => f === "ffmpeg", { status: null, error: "ENOENT" }),
				),
			).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("ffmpeg");
			// gen-audio.py fails.
			expect(
				await execBench(
					["--audio-dir", audio, "--results", results],
					spawnWhere((f, a) => (a[0] ?? "").endsWith("gen-audio.py"), {
						status: 2,
						stderr: "boom",
					}),
				),
			).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("gen-audio.py");
			// regen succeeds but produces nothing.
			expect(await execBench(["--audio-dir", audio, "--results", results], () => okResult)).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("no s*.wav fixtures");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("missing gold script and empty sweep output are named errors", async () => {
		const dir = benchDir();
		fs.writeFileSync(path.join(dir, "s0.wav"), "x"); // no s0.txt
		const results = path.join(dir, "results.json");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await execBench(["--audio-dir", dir, "--results", results], () => okResult)).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("gold script missing");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("sweep dependency failure and sweep failure are named errors", async () => {
		const dir = benchDir();
		fs.writeFileSync(path.join(dir, "s0.wav"), "x");
		fs.writeFileSync(path.join(dir, "s0.txt"), "gold");
		const results = path.join(dir, "results.json");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// faster_whisper import fails (fixtures exist → no regen).
			const depFail = (_file: string, args: readonly string[]) =>
				args[0] === "-c" && args[1]?.includes("faster_whisper")
					? { status: 1, stdout: "", stderr: "no module" }
					: okResult;
			expect(await execBench(["--audio-dir", dir, "--results", results], depFail)).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("faster-whisper");
			// bench-asr.py itself fails.
			const sweepFail = (_file: string, args: readonly string[]) =>
				(args[0] ?? "").endsWith("bench-asr.py")
					? { status: 3, stdout: "", stderr: "CUDA?" }
					: okResult;
			expect(await execBench(["--audio-dir", dir, "--results", results], sweepFail)).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("bench-asr.py");
			// Failure with EMPTY output — the error tail branch.
			const silentFail = (_file: string, args: readonly string[]) =>
				args[0] === "-c" ? { status: 1, stdout: "", stderr: "" } : okResult;
			expect(await execBench(["--audio-dir", dir, "--results", results], silentFail)).toBe(1);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("bad results file: invalid JSON, wrong shape, hyp-count mismatch", async () => {
		const dir = benchDir();
		fs.writeFileSync(path.join(dir, "s0.wav"), "x");
		fs.writeFileSync(path.join(dir, "s0.txt"), "gold");
		const results = path.join(dir, "results.json");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const spawnWriting =
			(content: string): BenchSpawn =>
			(file, args, env) => {
				if ((args[0] ?? "").endsWith("bench-asr.py")) {
					fs.writeFileSync(env.BENCH_RESULTS!, content);
				}
				return okResult;
			};
		try {
			// Not JSON at all.
			fs.writeFileSync(results, "not json{");
			// sweep "succeeds" but leaves the bad file in place.
			expect(await execBench(["--audio-dir", dir, "--results", results], () => okResult)).toBe(1);
			// Valid JSON, wrong shape.
			expect(
				await execBench(["--audio-dir", dir, "--results", results], spawnWriting('{"a":1}')),
			).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("not bench-asr.py output");
			// Right shape, wrong hyp count for the fixture set.
			expect(
				await execBench(
					["--audio-dir", dir, "--results", results],
					spawnWriting(JSON.stringify([{ model: "m", rtf: 0, peak_rss_mb: 0, hyps: ["a", "b"] }])),
				),
			).toBe(1);
			expect(errSpy.mock.calls.flat().join(" ")).toContain("hypotheses for 1 fixtures");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("nodeSpawn covers the real spawnSync boundary", () => {
		// True/false exist on unix CI; a bogus binary exercises the
		// error branch. (SpawnSync with utf8 never yields null stdout.)
		const ok = nodeSpawn("true", [], {});
		expect(ok.status).toBe(0);
		const fail = nodeSpawn("false", [], {});
		expect(fail.status).toBe(1);
		const missing = nodeSpawn("definitely-not-a-real-binary-xyz", [], {});
		expect(missing.error).toBeDefined();
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
			// A bogus profile is a usage error — deterministic, unlike a
			// bare `bench` which would probe the real python env.
			expect(await exec(["bench", "--profile", "bogus"])).toBe(2);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});
});

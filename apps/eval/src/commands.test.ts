import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { storeReportLayers } from "./adapters.ts";
import { repoRoot, type CmdContext } from "./context.ts";
import { generateCommand } from "./commands/generate.ts";
import { runCommand } from "./commands/run.ts";
import { gateCommand } from "./commands/gate.ts";
import { reportCommand } from "./commands/report.ts";
import { benchCommand } from "./commands/bench.ts";
import { listCommand } from "./commands/list.ts";
import { run } from "./cli.ts";

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

beforeAll(() => {
	evalsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-evals-"));
	fs.writeFileSync(path.join(evalsDir, "fx.ts"), SUITE);
	workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-data-"));
});

afterAll(() => {
	fs.rmSync(evalsDir, { recursive: true, force: true });
	fs.rmSync(workdir, { recursive: true, force: true });
});

describe("listCommand", () => {
	test("prints suite + resolution summary", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await listCommand([], ctx())).toBe(0);
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
			path.join(badDir, "bad.ts"),
			`export const suite = { id: "bad", domain: "d", dataset: { id: "d", version: "1" }, stages: ["ghost"], caps: {}, metrics: [], gates: [], schemaVersion: 1 };`,
		);
		try {
			vi.spyOn(console, "log").mockImplementation(() => {});
			expect(await listCommand(["--dir", badDir, "--strict"], ctx())).toBe(1);
			expect(await listCommand(["--dir", badDir], ctx())).toBe(0);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(badDir, { recursive: true, force: true });
		}
	});

	test("empty dir prints a notice", async () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-empty-"));
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await listCommand(["--dir", empty], ctx())).toBe(0);
			expect(spy.mock.calls.flat().join(" ")).toContain("no suite manifests");
		} finally {
			spy.mockRestore();
			fs.rmSync(empty, { recursive: true, force: true });
		}
	});
});

describe("generateCommand", () => {
	test("generates samples end-to-end under stub profile", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(
				await generateCommand(["fx", "--n", "2", "--workdir", workdir], {
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
				await generateCommand(
					[
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
					],
					ctx(),
				),
			).toBe(0);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("bad flags are errors", async () => {
		await expect(generateCommand(["nope", "--workdir", workdir], ctx())).rejects.toThrow(
			/unknown suite/,
		);
		await expect(
			generateCommand(["fx", "--profile", "bogus", "--workdir", workdir], ctx()),
		).rejects.toThrow(/unknown --profile/);
		await expect(
			generateCommand(["fx", "--noise", "loud", "--workdir", workdir], ctx()),
		).rejects.toThrow(/--noise/);
		await expect(
			generateCommand(["fx", "--locale", "en", "--workdir", workdir], ctx()),
		).rejects.toThrow(/unknown --locale/);
		await expect(
			generateCommand(["fx", "--template", "../x", "--workdir", workdir], ctx()),
		).rejects.toThrow(/bare template name/);
		await expect(generateCommand(["fx", "--workdir", "/etc"], ctx())).rejects.toThrow(/--workdir/);
	});

	test("unresolvable tts capability fails before any work", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-notts-"));
		fs.writeFileSync(
			path.join(dir, "notts.ts"),
			`export const suite = { id: "notts", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [], schemaVersion: 1 };`,
		);
		const c = { ...ctx(), evalsDir: dir };
		await expect(generateCommand(["notts", "--workdir", workdir], c)).rejects.toThrow(
			/capability "tts"/,
		);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("adapter failures surface as failed outcomes (exit 1)", { timeout: 30_000 }, async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-edge-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// local profile → edge-tts: the binary is absent in test env,
			// so every synthesis fails and the command reports failures.
			const code = await generateCommand(
				["fx", "--profile", "local", "--n", "1", "--workdir", wd],
				ctx(),
			);
			expect(code).toBe(1);
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
			const runCode = await runCommand(["fx", "--workdir", workdir], ctx());
			expect(runCode).toBe(0);

			// gate without --enforce is a report (0); with it, red → 1.
			expect(await gateCommand(["fx", "--workdir", workdir], ctx())).toBe(0);
			expect(await gateCommand(["fx", "--workdir", workdir, "--enforce"], ctx())).toBe(1);

			expect(await reportCommand(["fx", "--workdir", workdir], ctx())).toBe(0);
			expect(await reportCommand(["fx", "--workdir", workdir, "--run-id", "nope"], ctx())).toBe(0);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("run on an empty cohort exits 1", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-emptyrun-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await runCommand(["fx", "--workdir", wd], ctx())).toBe(1);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("gate/report on empty stores are clean no-ops", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-nodata-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await gateCommand(["fx", "--workdir", wd], ctx())).toBe(0);
			expect(await reportCommand(["fx", "--workdir", wd], ctx())).toBe(0);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("gate on a missing runId is a clean no-op", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await gateCommand(["fx", "--workdir", workdir, "--run-id", "nope"], ctx())).toBe(0);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("gate is GREEN (and enforce passes) when every result passes", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-green-"));
		const { store } = storeReportLayers(wd);
		const { DatasetStorePort } = await import("@ktb/eval-consult");
		const { Effect } = await import("effect");
		await Effect.runPromise(
			Effect.gen(function* () {
				const s = yield* DatasetStorePort;
				yield* s.putResult({
					runId: "green-run",
					sampleId: "good-1",
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
				await gateCommand(["fx", "--workdir", wd, "--run-id", "green-run", "--enforce"], ctx()),
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
			path.join(dir, "mgate.ts"),
			`export const suite = { id: "mgate", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [{ id: "mystery-gate" }], schemaVersion: 1 };`,
		);
		const c = { ...ctx(), evalsDir: dir };
		try {
			await expect(gateCommand(["mgate", "--workdir", workdir], c)).rejects.toThrow(/no runner/);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("report renders the latest runId and handles metric-less rows", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-report-"));
		const { store } = storeReportLayers(wd);
		const { DatasetStorePort } = await import("@ktb/eval-consult");
		const { Effect } = await import("effect");
		const put = (runId: string, sampleId: string, createdAt: number) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putResult({
						runId,
						sampleId,
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
			expect(await reportCommand(["fx", "--workdir", wd], ctx())).toBe(0);
			expect(await reportCommand(["fx", "--workdir", wd, "--run-id", "old-run"], ctx())).toBe(0);
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
				await runCommand(["fx", "--workdir", workdir, "--limit", "1", "--run-id", "run-lim"], c),
			).toBe(0);

			// A sample with no audio fails its step but not the batch.
			const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-badsample-"));
			await generateCommand(["fx", "--n", "1", "--workdir", wd], ctx());
			const { DatasetStorePort: DSP } = await import("@ktb/eval-consult");
			const { Effect: Eff } = await import("effect");
			const { store } = storeReportLayers(wd);
			await Eff.runPromise(
				Eff.gen(function* () {
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
				}).pipe(Eff.provide(store)),
			);
			expect(await runCommand(["fx", "--workdir", wd], ctx())).toBe(1);
			fs.rmSync(wd, { recursive: true, force: true });
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("gate flag overrides and unknown gate ids", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// Overrides parse and apply (still red — stub WER is huge).
			expect(
				await gateCommand(
					[
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
					],
					ctx(),
				),
			).toBe(0);
			await expect(
				gateCommand(["fx", "--workdir", workdir, "--stage", "bogus"], ctx()),
			).rejects.toThrow(/--stage/);
		} finally {
			vi.restoreAllMocks();
		}
	});
});

describe("benchCommand", () => {
	test("prints the deferral notice and exits 2", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await benchCommand([], ctx())).toBe(2);
			expect(spy.mock.calls.flat().join(" ")).toContain("not yet wired");
		} finally {
			spy.mockRestore();
		}
	});
});

describe("cli.run dispatch", () => {
	test("no args prints help, exit 2; help exits 0", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await run([])).toBe(2);
			expect(await run(["help"])).toBe(0);
			expect(await run(["--help"])).toBe(0);
			expect(spy.mock.calls.flat().join(" ")).toContain("usage: eval");
		} finally {
			spy.mockRestore();
		}
	});

	test("unknown command exits 2", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await run(["bogus"])).toBe(2);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("usage errors exit 2, command errors exit 1", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// Missing positional → UsageError → 2.
			expect(await run(["generate"])).toBe(2);
			// Unknown suite → Error → 1.
			expect(await run(["generate", "ghost", "--workdir", workdir])).toBe(1);
			// Unknown suite id on list path is N/A; gate on missing suite → 1.
			expect(await run(["gate", "ghost", "--workdir", workdir])).toBe(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("end-to-end via run(): generate → run → gate → report", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-e2e-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await run(["generate", "fx", "--n", "1", "--workdir", wd], ctx())).toBe(0);
			expect(await run(["run", "fx", "--workdir", wd], ctx())).toBe(0);
			expect(await run(["report", "fx", "--workdir", wd], ctx())).toBe(0);
			expect(await run(["list"])).toBe(0);
			expect(await run(["gate", "fx", "--workdir", wd], ctx())).toBe(0);
			expect(await run(["bench"])).toBe(2);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});
});

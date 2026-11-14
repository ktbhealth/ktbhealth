import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { FileSystem, Layer, Path, Stdio, Terminal } from "effect";
import { Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { EvalStorePort } from "@ktb/eval-core";
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

/** Domain-parametrized suite (P-079): `domain` points at the
 * paramsdom domain.ts fixture; `domainParams` overrides merge over
 * it — dataset defaults, a cohort tag, and an entity-category
 * subset the pipeline actually consumes. */
const SUITE_PARAMS = SUITE.replace('id: "fx"', 'id: "fx-params"')
	.replace('domain: "eval.consult"', 'domain: "eval.paramsdom"')
	.replace('dataset: { id: "fx", version: "v1" }', 'dataset: { id: "fxp", version: "v1" }')
	.replace(
		'adapterProfile: "stub",',
		`adapterProfile: "stub",
	domainParams: { params: { dataset: { count: 1 }, cohort: "p1", entityCategories: ["medication"] } },`,
	);

beforeAll(() => {
	evalsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-evals-"));
	fs.writeFileSync(path.join(evalsDir, "fx.suite.ts"), SUITE);
	fs.writeFileSync(path.join(evalsDir, "fx-nojudge.suite.ts"), SUITE_NOJUDGE);
	fs.writeFileSync(path.join(evalsDir, "fx-badorder.suite.ts"), SUITE_BADORDER);
	fs.writeFileSync(path.join(evalsDir, "fx-asr.suite.ts"), SUITE_ASR);
	fs.writeFileSync(path.join(evalsDir, "fx-params.suite.ts"), SUITE_PARAMS);
	// Domain definitions (P-079): eval.consult mirrors the consultation
	// pack's vocabulary closely enough that fixture behavior is
	// unchanged; eval.paramsdom exercises param overrides. templates
	// resolves through a symlink to the real pack templates.
	fs.writeFileSync(
		path.join(evalsDir, "domain.ts"),
		`export const domain = {
			id: "eval.consult",
			version: "1",
			locale: { profile: "ptbr-v1", tag: "pt-BR" },
			templates: { dir: "templates" },
			personas: {
				regions: ["southeast", "south", "northeast", "north", "central_west"],
				ageBands: ["child", "adult", "elderly"],
				registers: ["formal", "colloquial"],
				specialties: ["general_practice", "pediatrics", "gynecology", "geriatrics", "cardiology", "psychiatry"],
			},
			params: { dataset: { seed: 100 }, voices: ["br_male_1", "br_female_1"] },
		};`,
	);
	fs.mkdirSync(path.join(evalsDir, "paramsdom"));
	fs.writeFileSync(
		path.join(evalsDir, "paramsdom", "domain.ts"),
		`export const domain = {
			id: "eval.paramsdom",
			version: "1",
			params: { dataset: { noise: "clinic", count: 3 } },
		};`,
	);
	fs.symlinkSync(
		path.join(repoRoot(), "evals", "consultation", "templates"),
		path.join(evalsDir, "templates"),
	);
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

	test("list prints preset expansion and invalid configs (P-078)", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-listcfg-"));
		fs.writeFileSync(
			path.join(dir, "cfg.suite.ts"),
			`export const suite = { id: "cfg", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [{ id: "wer", config: { bogus: 1 } }], gates: [{ preset: "consult.strict" }, { preset: "ghost" }], schemaVersion: 1 };`,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["list", "--dir", dir])).toBe(0);
			const out = spy.mock.calls.map((c) => String(c[0])).join("\n");
			// Expanded gate count: consult.strict → 1 gate; ghost → 0.
			expect(out).toMatch(/gate\s+1\/1 resolved/);
			expect(out).toMatch(/gatepreset\s+1\/2 resolved, 1 unresolved/);
			expect(out).toContain('gatepreset "ghost"');
			expect(out).toContain('metric "wer" — invalid config:');
			expect(out).toContain("1 unresolved ref(s), 1 invalid config(s)");
			// --strict fails on BOTH unresolved refs and bad configs.
			expect(await exec(["list", "--dir", dir, "--strict"])).toBe(1);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
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

	test("list resolves domain definitions and reports domain errors (P-079)", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-listdom-"));
		fs.writeFileSync(
			path.join(dir, "domain.ts"),
			`export const domain = { id: "eval.d", version: "3", params: { a: 1 } };`,
		);
		fs.mkdirSync(path.join(dir, "child", "src"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, "child", "src", "domain.ts"),
			`export const domain = { id: "eval.child", version: "1", extends: "eval.d" };`,
		);
		fs.writeFileSync(
			path.join(dir, "ok.suite.ts"),
			`export const suite = { id: "ok", domain: "eval.d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [], domainParams: { params: { b: 2 } }, schemaVersion: 1 };`,
		);
		fs.writeFileSync(
			path.join(dir, "kid.suite.ts"),
			`export const suite = { id: "kid", domain: "eval.child", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [], schemaVersion: 1 };`,
		);
		fs.mkdirSync(path.join(dir, "plain", "src"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, "plain", "src", "domain.ts"),
			`export const domain = { id: "eval.plain", version: "2" };`,
		);
		fs.writeFileSync(
			path.join(dir, "plain.suite.ts"),
			`export const suite = { id: "plain", domain: "eval.plain", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [], schemaVersion: 1 };`,
		);
		fs.writeFileSync(
			path.join(dir, "bad.suite.ts"),
			`export const suite = { id: "bad", domain: "eval.d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [], domainParams: { bogus: 1 }, schemaVersion: 1 };`,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["list", "--dir", dir])).toBe(0);
			const out = spy.mock.calls.map((c) => String(c[0])).join("\n");
			expect(out).toContain("domain-def  eval.d v3");
			expect(out).toContain("domain-def  eval.child v1 extends eval.d");
			expect(out).toContain("domain-def  eval.plain v2");
			expect(out).not.toContain("eval.plain v2 ·");
			expect(out).toContain("! domain —");
			expect(out).toContain("1 domain error(s)");
			expect(await exec(["list", "--dir", dir, "--strict"])).toBe(1);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
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

	test("domainParams flow into generate + run (P-079)", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// eval.paramsdom supplies noise=clinic; domainParams
			// overrides count/cohort/entityCategories on top.
			expect(await exec(["generate", "fx-params", "--n", "1", "--workdir", workdir])).toBe(0);
			expect(await exec(["run", "fx-params", "--workdir", workdir, "--run-id", "run-params"])).toBe(
				0,
			);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("domain fallbacks: no definition, missing templates dir, invalid domainParams", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-dom-"));
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-domwd-"));
		const suiteFor = (id: string, domain: string, dataset: string, extra = "") =>
			`export const suite = { id: "${id}", domain: "${domain}", dataset: { id: "${dataset}", version: "v1" }, stages: ["transcribe"], caps: { tts: "transcription.tts", asr: "transcription.asr", llm: "llm.eval", eval: "llm.eval", store: "storage.dataset", report: "storage.dataset", registry: "storage.dataset" }, metrics: [], gates: [], schemaVersion: 1, adapterProfile: "stub" ${extra} };`;
		fs.writeFileSync(
			path.join(dir, "domain.ts"),
			`export const domain = { id: "eval.d", version: "1", templates: { dir: "nope" } };`,
		);
		// No domain.ts for "d" → full pre-P-079 fallback path.
		fs.writeFileSync(path.join(dir, "plain.suite.ts"), suiteFor("plain", "d", "dp"));
		// templates.dir resolves to a missing dir → honest read failure.
		fs.writeFileSync(path.join(dir, "badtmpl.suite.ts"), suiteFor("badtmpl", "eval.d", "dt"));
		// Invalid domainParams → usage error in both generate and run.
		fs.writeFileSync(
			path.join(dir, "badparams.suite.ts"),
			suiteFor("badparams", "eval.d", "db", ", domainParams: { bogus: 1 }"),
		);
		const c = { ...ctx(), evalsDir: dir };
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await exec(["generate", "plain", "--n", "1", "--workdir", wd], c)).toBe(0);
			expect(await exec(["generate", "badtmpl", "--n", "1", "--workdir", wd], c)).toBe(1);
			expect(await exec(["generate", "badparams", "--n", "1", "--workdir", wd], c)).toBe(2);
			expect(await exec(["run", "badparams", "--workdir", wd], c)).toBe(2);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
			fs.rmSync(wd, { recursive: true, force: true });
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

	test("run fails on invalid contribution config before any work (P-078)", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-cfg-"));
		fs.writeFileSync(
			path.join(dir, "cfg.suite.ts"),
			`export const suite = { id: "cfg", domain: "d", dataset: { id: "d", version: "1" }, stages: ["transcribe"], caps: { asr: "transcription.asr", llm: "llm.eval", eval: "llm.eval" }, metrics: [{ id: "wer", config: { bogus: 1 } }], gates: [], schemaVersion: 1 };`,
		);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "cfg", "--workdir", workdir], { ...ctx(), evalsDir: dir })).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("invalid contribution config");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
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

	test("gate expands preset refs and applies overrides (P-078)", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-pgate-"));
		fs.writeFileSync(
			path.join(dir, "pgate.suite.ts"),
			`export const suite = { id: "pgate", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [{ preset: "consult.strict", overrides: { "auto-accept": { minN: 1 } } }], schemaVersion: 1 };`,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["gate", "pgate", "--workdir", workdir], { ...ctx(), evalsDir: dir })).toBe(
				0,
			);
			// No results under this dataset pin → honest empty report.
			expect(spy.mock.calls.flat().join(" ")).toContain("no results");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("gate with an unresolvable preset is a usage error (exit 2)", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-ggate-"));
		fs.writeFileSync(
			path.join(dir, "ggate.suite.ts"),
			`export const suite = { id: "ggate", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [{ preset: "ghost" }], schemaVersion: 1 };`,
		);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await exec(["gate", "ggate", "--workdir", workdir], { ...ctx(), evalsDir: dir })).toBe(
				2,
			);
			expect(err.mock.calls.flat().join(" ")).toContain("ghost");
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

describe("market parity (P-076)", () => {
	/** EvalStorePort helpers over a workdir's local store. */
	const withEvalStore = <A>(wd: string, e: Effect.Effect<A, unknown, EvalStorePort>) =>
		Effect.runPromise(Effect.provide(e, storeReportLayers(wd).evalStore));

	test("generate registers a DatasetManifest + Experiment; regen idempotent, drift conflicts", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-gen-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const c = { ...ctx(), fetchImpl: fetch };
			expect(
				await exec(
					["generate", "fx", "--n", "2", "--seed", "11", "--run-id", "gen-reg", "--workdir", wd],
					c,
				),
			).toBe(0);

			const ds = await withEvalStore<{
				sampleCount: number;
				contentHash: string;
				generator: Record<string, unknown>;
			} | null>(
				wd,
				Effect.gen(function* () {
					const s = yield* EvalStorePort;
					return yield* s.getDatasetManifest("fx", "v1");
				}),
			);
			expect(ds?.sampleCount).toBe(2);
			expect(ds?.contentHash).toMatch(/^[0-9a-f]{64}$/);
			expect(ds?.generator).toMatchObject({ suiteId: "fx", seed: 11 });

			const exp = await withEvalStore<Record<string, unknown> | null>(
				wd,
				Effect.gen(function* () {
					const s = yield* EvalStorePort;
					return yield* s.getExperiment("gen-reg");
				}),
			);
			expect(exp).toMatchObject({
				kind: "generate",
				suiteId: "fx",
				dataset: { id: "fx", version: "v1" },
			});
			expect(exp?.manifestHash).toMatch(/^[0-9a-f]{64}$/);
			expect(exp?.gitSha).toMatch(/^[0-9a-f]{40}$/);
			expect(exp?.summary).toMatchObject({ samples: 2, failed: 0 });

			// Byte-identical regen → same contentHash → idempotent pass.
			expect(
				await exec(
					["generate", "fx", "--n", "2", "--seed", "11", "--run-id", "gen-reg2", "--workdir", wd],
					c,
				),
			).toBe(0);
			// Different seed → different cohort → registry conflict.
			const err = vi.spyOn(console, "error").mockImplementation(() => {});
			expect(
				await exec(
					["generate", "fx", "--n", "2", "--seed", "22", "--run-id", "gen-reg3", "--workdir", wd],
					c,
				),
			).toBe(1);
			expect(err.mock.calls.flat().join(" ")).toContain("already registered");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("run records an experiment; gate --run-id attaches verdicts; report --compare diffs", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-run-"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const c = { ...ctx(), fetchImpl: fetch };
			expect(await exec(["generate", "fx", "--n", "1", "--seed", "3", "--workdir", wd], c)).toBe(0);
			expect(await exec(["run", "fx", "--workdir", wd, "--run-id", "run-a"], c)).toBe(0);
			expect(await exec(["run", "fx", "--workdir", wd, "--run-id", "run-b"], c)).toBe(0);

			// Gate attaches per-gate verdicts onto run-a's experiment.
			expect(await exec(["gate", "fx", "--workdir", wd, "--run-id", "run-a"])).toBe(0);
			const expA = await withEvalStore<Record<string, unknown> | null>(
				wd,
				Effect.gen(function* () {
					const s = yield* EvalStorePort;
					return yield* s.getExperiment("run-a");
				}),
			);
			expect(expA).toMatchObject({ kind: "run", suiteId: "fx" });
			const summaryA = (expA as { summary: Record<string, unknown> }).summary;
			expect(summaryA.meanWerAsr).toBeTypeOf("number");
			expect((expA as { gates: unknown[] }).gates).toHaveLength(2);

			// report --compare renders the markdown diff.
			log.mockClear();
			expect(
				await exec(["report", "fx", "--workdir", wd, "--compare", "run-a", "--compare", "run-b"]),
			).toBe(0);
			const cmp = log.mock.calls.flat().join("\n");
			expect(cmp).toContain("# experiment compare");
			expect(cmp).toContain("`run-a`");
			expect(cmp).toContain("`run-b`");
			expect(cmp).toContain("summary.meanWerAsr");

			// Missing experiment → command error; >2 ids → usage error.
			expect(
				await exec([
					"report",
					"fx",
					"--workdir",
					wd,
					"--compare",
					"run-a",
					"--compare",
					"ghost-exp",
				]),
			).toBe(1);
			expect(err.mock.calls.flat().join(" ")).toContain('experiment "ghost-exp"');
			// Missing FIRST id names the same error.
			expect(
				await exec([
					"report",
					"fx",
					"--workdir",
					wd,
					"--compare",
					"ghost-exp",
					"--compare",
					"run-a",
				]),
			).toBe(1);
			expect(err.mock.calls.flat().join(" ")).toContain('experiment "ghost-exp"');
			expect(
				await exec([
					"report",
					"fx",
					"--workdir",
					wd,
					"--compare",
					"a",
					"--compare",
					"b",
					"--compare",
					"c",
				]),
			).toBe(2);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("a run where every sample fails still records an honest experiment", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-fail-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// One sample with NO audio → every stage fails; the batch
			// reports failure but the experiment must still persist
			// with ok:0 and no mean-WER fields.
			const { store } = storeReportLayers(wd);
			const { DatasetStorePort } = await import("@ktb/eval-consultation");
			await Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putSample({
						id: "no-audio-1",
						datasetVersion: "fx-v1",
						origin: "synthetic",
						script: "Doctor: oi?",
						scriptHash: "h",
						persona: { region: "r", ageBand: "a", register: "f", specialty: "s" },
						gold: { validatedBy: "generator" },
					});
				}).pipe(Effect.provide(store)),
			);
			expect(await exec(["run", "fx", "--workdir", wd, "--run-id", "run-fail"])).toBe(1);
			const exp = await withEvalStore<Record<string, unknown> | null>(
				wd,
				Effect.gen(function* () {
					const s = yield* EvalStorePort;
					return yield* s.getExperiment("run-fail");
				}),
			);
			expect(exp?.kind).toBe("run");
			expect(exp?.summary).toMatchObject({ ok: 0, failed: 1, samples: 1 });
			expect((exp?.summary as Record<string, unknown> | undefined)?.meanWerAsr).toBeUndefined();
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("gate --format json emits machine-readable verdicts; empty store serializes honestly", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-gate-"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const c = { ...ctx(), fetchImpl: fetch };
			expect(await exec(["generate", "fx", "--n", "1", "--seed", "5", "--workdir", wd], c)).toBe(0);
			expect(await exec(["run", "fx", "--workdir", wd, "--run-id", "run-j"], c)).toBe(0);

			log.mockClear();
			expect(
				await exec(["gate", "fx", "--workdir", wd, "--run-id", "run-j", "--format", "json"]),
			).toBe(0);
			const line = log.mock.calls.map((c2) => String(c2[0])).find((l) => l.startsWith("{"));
			expect(line).toBeDefined();
			const parsed = JSON.parse(line!) as {
				suite: string;
				datasetVersion: string;
				runId: string | null;
				results: number;
				gates: { id: string; green: boolean; accepted: number; total: number }[];
				allGreen: boolean;
			};
			expect(parsed.suite).toBe("fx");
			expect(parsed.datasetVersion).toBe("fx-v1");
			expect(parsed.runId).toBe("run-j");
			expect(parsed.results).toBe(1);
			expect(parsed.gates.length).toBe(2);
			expect(typeof parsed.allGreen).toBe("boolean");

			// Non-empty store WITHOUT --run-id → runId serializes null.
			log.mockClear();
			expect(await exec(["gate", "fx", "--workdir", wd, "--format", "json"])).toBe(0);
			const noRun = JSON.parse(
				log.mock.calls.map((c2) => String(c2[0])).find((l) => l.startsWith("{"))!,
			) as { runId: string | null; results: number };
			expect(noRun.runId).toBeNull();
			expect(noRun.results).toBe(1);

			// Empty store → honest empty JSON, still exit 0.
			const wd2 = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-gate2-"));
			log.mockClear();
			expect(await exec(["gate", "fx", "--workdir", wd2, "--format", "json"])).toBe(0);
			const empty = JSON.parse(
				log.mock.calls.map((c2) => String(c2[0])).find((l) => l.startsWith("{"))!,
			) as { results: number; gates: unknown[]; allGreen: boolean };
			expect(empty.results).toBe(0);
			expect(empty.gates).toEqual([]);
			expect(empty.allGreen).toBe(false);
			fs.rmSync(wd2, { recursive: true, force: true });
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("gate --format rejects unknown values; --run-id without an experiment prints a note", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-gatenote-"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			// Seed a result whose runId has NO experiment — the gate
			// must still evaluate and only note the missing tracking.
			const { store } = storeReportLayers(wd);
			const { DatasetStorePort } = await import("@ktb/eval-consultation");
			await Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putResult({
						runId: "manual-run",
						sampleId: "m1",
						datasetVersion: "fx-v1",
						asrText: "t",
						editVerdicts: [],
						confSegments: [],
						createdAt: 1,
					});
				}).pipe(Effect.provide(store)),
			);
			expect(await exec(["gate", "fx", "--workdir", wd, "--format", "yaml"])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("--format");
			log.mockClear();
			expect(await exec(["gate", "fx", "--workdir", wd, "--run-id", "manual-run"])).toBe(0);
			expect(log.mock.calls.flat().join("\n")).toContain('no experiment "manual-run"');
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("list --workdir validates dataset pins; strict without --workdir skips honestly", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-list-"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// No manifest yet → every suite's pin is missing.
			expect(await exec(["list", "--workdir", wd])).toBe(0);
			expect(log.mock.calls.flat().join("\n")).toContain('! dataset "fx@v1"');
			expect(await exec(["list", "--workdir", wd, "--strict"])).toBe(1);

			// Strict WITHOUT --workdir: registry check skipped, note printed.
			log.mockClear();
			expect(await exec(["list", "--strict"])).toBe(0);
			expect(log.mock.calls.flat().join("\n")).toContain("dataset registry check skipped");

			// After generate, the pin resolves and strict passes —
			// generate every suite in the dir (fx-params pins fxp@v1).
			const c = { ...ctx(), fetchImpl: fetch };
			expect(await exec(["generate", "fx", "--n", "1", "--seed", "1", "--workdir", wd], c)).toBe(0);
			expect(
				await exec(["generate", "fx-params", "--n", "1", "--seed", "1", "--workdir", wd], c),
			).toBe(0);
			log.mockClear();
			expect(await exec(["list", "--workdir", wd, "--strict"])).toBe(0);
			const out = log.mock.calls.flat().join("\n");
			expect(out).toContain("registered");
			expect(out).not.toContain("! dataset");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("calibrate scores judge-vs-gold, persists JSONL + store report", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-cal-"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			const { store } = storeReportLayers(wd);
			const { DatasetStorePort } = await import("@ktb/eval-consultation");
			await Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putSample({
						id: "cal-s1",
						datasetVersion: "fx-v1",
						origin: "synthetic",
						script: "Doctor: toma dipirona. Patient: sem febre.",
						scriptHash: "h1",
						persona: { region: "r", ageBand: "a", register: "f", specialty: "s" },
						gold: {
							validatedBy: "generator",
							entities: [
								{ category: "medication", value: "dipirona" },
								{ category: "dosage", value: "5 mg" },
								{ category: "negation", value: "sem febre" },
							],
						},
					});
					yield* s.putSample({
						id: "cal-s2",
						datasetVersion: "fx-v1",
						origin: "synthetic",
						script: "x",
						scriptHash: "h2",
						persona: { region: "r", ageBand: "a", register: "f", specialty: "s" },
						gold: {
							validatedBy: "generator",
							entities: [
								{ category: "medication", value: "dipirona" },
								{ category: "dosage", value: "5 mg" },
								{ category: "negation", value: "sem febre" },
							],
						},
					});
					yield* s.putSample({
						id: "cal-s3",
						datasetVersion: "fx-v1",
						origin: "synthetic",
						script: "x",
						scriptHash: "h3",
						persona: { region: "r", ageBand: "a", register: "f", specialty: "s" },
						gold: { validatedBy: "generator" },
					});
					// Stage 1 (asr): mixed judge/floor verdicts — agreement,
					// unjudged floor rows, unverifiable statuses, a floor
					// miss, and scored + unscored confidences.
					yield* s.putResult({
						runId: "cal-run",
						sampleId: "cal-s1",
						datasetVersion: "fx-v1",
						asrText: "paciente toma dipirona sem febre",
						asrMetrics: {
							wer: 0.1,
							cer: 0.1,
							criticalErrors: 0,
							entityVerdicts: [
								{
									category: "medication",
									entity: "dipirona",
									status: "correct",
									source: "judge",
									probability: 0.9,
								},
								{
									category: "medication",
									entity: "dipirona",
									status: "correct",
									source: "text_floor",
								},
								{ category: "dosage", entity: "5 mg", status: "dropped", source: "judge" },
								{ category: "dosage", entity: "5 mg", status: "dropped", source: "text_floor" },
								{
									category: "negation",
									entity: "sem febre",
									status: "correct",
									source: "judge",
									probability: 0.5,
								},
								{ category: "medication", entity: "dipirona", status: "invented", source: "judge" },
								{
									category: "medication",
									entity: "paracetamol",
									status: "correct",
									source: "judge",
									probability: 0.7,
								},
							],
						},
						editVerdicts: [],
						confSegments: [],
						createdAt: 1,
					});
					// Stage 2 (corrected): judge disagrees with the floor.
					yield* s.putResult({
						runId: "cal-run",
						sampleId: "cal-s2",
						datasetVersion: "fx-v1",
						asrText: "paciente toma dipirona sem febre",
						asrMetrics: {
							wer: 0.1,
							cer: 0.1,
							criticalErrors: 0,
							entityVerdicts: [],
						},
						correctedText: "paciente toma dipirona",
						correctedMetrics: {
							wer: 0.2,
							cer: 0.2,
							criticalErrors: 0,
							entityVerdicts: [
								{
									category: "medication",
									entity: "dipirona",
									status: "dropped",
									source: "judge",
									probability: 0.4,
								},
							],
						},
						editVerdicts: [],
						confSegments: [],
						createdAt: 2,
					});
					// No metrics at all → stage skipped; correctedText
					// without correctedMetrics → stage excluded.
					yield* s.putResult({
						runId: "cal-run",
						sampleId: "cal-s3",
						datasetVersion: "fx-v1",
						asrText: "x",
						correctedText: "y",
						editVerdicts: [],
						confSegments: [],
						createdAt: 3,
					});
					// Result whose sample was never persisted → missing.
					yield* s.putResult({
						runId: "cal-run",
						sampleId: "ghost-sample",
						datasetVersion: "fx-v1",
						asrText: "x",
						editVerdicts: [],
						confSegments: [],
						createdAt: 4,
					});
				}).pipe(Effect.provide(store)),
			);

			// Judge identities from the run-record JSONL: judge-stage
			// records for THIS run only, engine required, model optional,
			// torn lines tolerated.
			fs.mkdirSync(path.join(wd, "reports"), { recursive: true });
			fs.writeFileSync(
				path.join(wd, "reports", "eval.jsonl"),
				[
					JSON.stringify({ stage: "judge", runId: "cal-run", engine: "stub-eval", model: "m1" }),
					JSON.stringify({ stage: "judge", runId: "cal-run", engine: "stub-eval", model: "m1" }),
					JSON.stringify({ stage: "asr", runId: "cal-run", engine: "asr-x" }),
					JSON.stringify({ stage: "judge", runId: "other-run", engine: "jev" }),
					JSON.stringify({ stage: "judge", runId: "cal-run" }),
					JSON.stringify({ stage: "judge", runId: "cal-run", engine: "jev2" }),
					"not-json{",
					"",
				].join("\n"),
			);

			expect(await exec(["calibrate", "fx", "--workdir", wd, "--run-id", "cal-run"])).toBe(0);
			const out = log.mock.calls.flat().join("\n");
			expect(out).toContain("# judge calibration — fx");
			expect(out).toContain("run cal-run");
			expect(out).toContain("stub-eval/m1");
			expect(out).toContain("jev2");
			expect(out).not.toContain("asr-x");
			expect(out).toContain("coverage: 3 scored");
			expect(out).toContain("1 result(s) without sample");

			// JSONL record + EvalStorePort persistence.
			const jsonl = fs
				.readFileSync(path.join(wd, "reports", "calibrations.jsonl"), "utf8")
				.trim()
				.split("\n");
			expect(jsonl).toHaveLength(1);
			const stored = JSON.parse(jsonl[0]!) as {
				suiteId: string;
				runId?: string;
				questions: number;
				agreements: number;
				judges: { engine: string }[];
			};
			expect(stored.suiteId).toBe("fx");
			expect(stored.runId).toBe("cal-run");
			expect(stored.questions).toBe(3);
			expect(stored.agreements).toBe(2);
			expect(stored.judges.map((j) => j.engine)).toEqual(["stub-eval", "jev2"]);

			const listed = await withEvalStore<readonly { id: string }[]>(
				wd,
				Effect.gen(function* () {
					const s = yield* EvalStorePort;
					return yield* s.listCalibrationReports({ suiteId: "fx" });
				}),
			);
			expect(listed).toHaveLength(1);
			expect(listed[0]?.id).toMatch(/^cal-fx-/);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("calibrate: empty store, zero scored questions, and no --run-id scope", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-p076-cal2-"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// Empty store → clean no-op (with and without --run-id).
			expect(await exec(["calibrate", "fx", "--workdir", wd])).toBe(0);
			expect(log.mock.calls.flat().join("\n")).toContain("nothing to calibrate");
			log.mockClear();
			expect(await exec(["calibrate", "fx", "--workdir", wd, "--run-id", "ghost"])).toBe(0);
			expect(log.mock.calls.flat().join("\n")).toContain("(run ghost)");

			// Results exist but every verdict is text_floor → n=0 path.
			const { store } = storeReportLayers(wd);
			const { DatasetStorePort } = await import("@ktb/eval-consultation");
			await Effect.runPromise(
				Effect.gen(function* () {
					const s = yield* DatasetStorePort;
					yield* s.putSample({
						id: "cal-s2",
						datasetVersion: "fx-v1",
						origin: "synthetic",
						script: "x",
						scriptHash: "h",
						persona: { region: "r", ageBand: "a", register: "f", specialty: "s" },
						gold: {
							validatedBy: "generator",
							entities: [{ category: "medication", value: "dipirona" }],
						},
					});
					yield* s.putResult({
						runId: "cal-run2",
						sampleId: "cal-s2",
						datasetVersion: "fx-v1",
						asrText: "sem dipirona",
						asrMetrics: {
							wer: 0,
							cer: 0,
							criticalErrors: 0,
							entityVerdicts: [
								{
									category: "medication",
									entity: "dipirona",
									status: "dropped",
									source: "text_floor",
								},
							],
						},
						editVerdicts: [],
						confSegments: [],
						createdAt: 1,
					});
				}).pipe(Effect.provide(store)),
			);

			// No --run-id: all runs scoped by datasetVersion; report has
			// no runId field; judges list empty (no eval.jsonl).
			log.mockClear();
			expect(await exec(["calibrate", "fx", "--workdir", wd])).toBe(0);
			const out = log.mock.calls.flat().join("\n");
			expect(out).toContain("coverage: 0 scored");
			expect(out).toContain("judges: none recorded");
			const jsonl = fs
				.readFileSync(path.join(wd, "reports", "calibrations.jsonl"), "utf8")
				.trim()
				.split("\n");
			expect(jsonl).toHaveLength(1);
			const stored = JSON.parse(jsonl[0]!) as { runId?: string; questions: number };
			expect(stored.runId).toBeUndefined();
			expect(stored.questions).toBe(0);
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});
});

describe("cross-suite inputs + stage DAG guards (P-077)", () => {
	/** Suite consuming fx's persisted asrText — same dataset pin so
	 * the cohort matches; transcribe omitted (prior text replaces it). */
	const reviewSuite = (runId: string) => `export const suite = {
	id: "fx-review",
	domain: "eval.consult",
	dataset: { id: "fx", version: "v1" },
	stages: ["script_gen", "synthesize", "cleanup", "judge"],
	caps: {
		tts: "transcription.tts",
		asr: "transcription.asr",
		llm: "llm.eval",
		eval: "llm.eval",
		store: "storage.dataset",
		report: "storage.dataset",
	},
	metrics: ["wer"],
	gates: [],
	inputs: [{ suite: "fx", stage: "transcribe", field: "asrText", runId: "${runId}" }],
	schemaVersion: 1,
	adapterProfile: "stub",
};`;

	const experimentsOf = async (suiteId: string) => {
		const { evalStore } = storeReportLayers(workdir);
		return Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const s = yield* EvalStorePort;
					return yield* s.listExperiments({ suiteId });
				}).pipe(Effect.provide(evalStore)),
			),
		);
	};

	test("run consumes another suite's asrText and records derivedFrom lineage", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			// Pin the input to fx's full (2-sample) run — later limited
			// runs must not shadow it.
			const exps = await experimentsOf("fx");
			const full = exps
				.filter((e) => e.kind === "run" && e.summary.samples === 2)
				.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]!;
			fs.writeFileSync(path.join(evalsDir, "fx-review.suite.ts"), reviewSuite(full.id));

			expect(await exec(["run", "fx-review", "--workdir", workdir])).toBe(0);

			const review = [...(await experimentsOf("fx-review"))].sort(
				(a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0),
			)[0]!;
			expect(review.derivedFrom).toEqual([full.id]);
			const inputs = review.summary.inputs as { runId: string; suite: string }[];
			expect(inputs).toHaveLength(1);
			expect(inputs[0]!.runId).toBe(full.id);
			expect(inputs[0]!.suite).toBe("fx");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("eval list warns on unresolvable input refs; --strict fails", async () => {
		fs.writeFileSync(
			path.join(evalsDir, "fx-badinput.suite.ts"),
			`export const suite = { id: "fx-badinput", domain: "d", dataset: { id: "fx", version: "v1" }, stages: ["transcribe"], caps: {}, metrics: [], gates: [], inputs: [{ suite: "ghost" }], schemaVersion: 1, adapterProfile: "stub" };`,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["list"])).toBe(0);
			const out = spy.mock.calls.flat().join("\n");
			expect(out).toContain('! input "ghost"');
			expect(out).toContain("unresolvable input(s)");
			expect(await exec(["list", "--strict"])).toBe(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("eval list prints resolved input refs", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["list"])).toBe(0);
			const out = spy.mock.calls.flat().join("\n");
			expect(out).toContain("input  fx#transcribe.asrText → fx");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("run fails hard on an unresolvable input suite", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "fx-badinput", "--workdir", workdir])).toBe(1);
			expect(err.mock.calls.flat().join(" ")).toContain('no suite manifest "ghost"');
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("run fails hard when the input resolves no persisted results", async () => {
		const wd = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cmd-noinput-"));
		fs.writeFileSync(
			path.join(evalsDir, "fx-nodata.suite.ts"),
			`export const suite = { id: "fx-nodata", domain: "d", dataset: { id: "fx", version: "v1" }, stages: ["script_gen", "synthesize", "cleanup"], caps: { tts: "transcription.tts", asr: "transcription.asr", llm: "llm.eval", eval: "llm.eval", store: "storage.dataset", report: "storage.dataset" }, metrics: [], gates: [], inputs: [{ suite: "fx", stage: "transcribe" }], schemaVersion: 1, adapterProfile: "stub" };`,
		);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "fx-nodata", "--workdir", wd])).toBe(1);
			expect(err.mock.calls.flat().join(" ")).toContain("resolved no results");
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(wd, { recursive: true, force: true });
		}
	});

	test("run rejects a non-linear stage graph (linear-only runner)", async () => {
		fs.writeFileSync(
			path.join(evalsDir, "fx-nonlinear.suite.ts"),
			`export const suite = { id: "fx-nonlinear", domain: "d", dataset: { id: "fx", version: "v1" }, stages: ["transcribe", { id: "cleanup", needs: [] }, "judge"], caps: {}, metrics: [], gates: [], schemaVersion: 1, adapterProfile: "stub" };`,
		);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "fx-nonlinear", "--workdir", workdir])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("non-linear stage graph");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("run rejects asrText input combined with a live transcribe stage", async () => {
		fs.writeFileSync(
			path.join(evalsDir, "fx-both.suite.ts"),
			`export const suite = { id: "fx-both", domain: "d", dataset: { id: "fx", version: "v1" }, stages: ["transcribe", "cleanup"], caps: {}, metrics: [], gates: [], inputs: [{ suite: "fx", stage: "transcribe" }], schemaVersion: 1, adapterProfile: "stub" };`,
		);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["run", "fx-both", "--workdir", workdir])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("mutually exclusive");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("eval list surfaces DAG graph errors", async () => {
		fs.writeFileSync(
			path.join(evalsDir, "fx-cycle.suite.ts"),
			`export const suite = { id: "fx-cycle", domain: "d", dataset: { id: "fx", version: "v1" }, stages: [{ id: "a", needs: ["b"] }, { id: "b", needs: ["a"] }], caps: {}, metrics: [], gates: [], schemaVersion: 1, adapterProfile: "stub" };`,
		);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(await exec(["list"])).toBe(0);
			const out = spy.mock.calls.flat().join("\n");
			expect(out).toContain("! dag —");
			expect(out).toContain("invalid stage graph(s)");
			expect(await exec(["list", "--strict"])).toBe(1);
		} finally {
			vi.restoreAllMocks();
		}
	});
});

describe("stage DAG node guards + non-asrText inputs (P-077)", () => {
	const CAPS = `caps: { tts: "transcription.tts", asr: "transcription.asr", llm: "llm.eval", eval: "llm.eval", store: "storage.dataset", report: "storage.dataset" }`;
	const base = (id: string, stages: string, extra = "") =>
		`export const suite = { id: "${id}", domain: "d", dataset: { id: "fx", version: "v1" }, stages: ${stages}, ${CAPS}, metrics: [], gates: [], schemaVersion: 1, adapterProfile: "stub" ${extra} };`;

	const writeSuite = (name: string, src: string) =>
		fs.writeFileSync(path.join(evalsDir, `${name}.suite.ts`), src);

	const quiet = () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		return err;
	};

	test("explicit needs matching the linear chain are accepted", async () => {
		writeSuite(
			"fx-linear-explicit",
			base(
				"fx-linear-explicit",
				'["transcribe", { id: "cleanup", needs: ["transcribe"] }, "judge"]',
			),
		);
		quiet();
		try {
			expect(await exec(["run", "fx-linear-explicit", "--workdir", workdir])).toBe(0);
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("needs referencing a non-earlier stage is non-linear", async () => {
		writeSuite(
			"fx-wrongdep",
			base("fx-wrongdep", '["transcribe", { id: "cleanup", needs: ["judge"] }, "judge"]'),
		);
		const err = quiet();
		try {
			expect(await exec(["run", "fx-wrongdep", "--workdir", workdir])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("non-linear stage graph");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("optional and when node features are non-linear", async () => {
		writeSuite(
			"fx-optional",
			base("fx-optional", '["transcribe", { id: "cleanup", optional: true }, "judge"]'),
		);
		writeSuite(
			"fx-when",
			base("fx-when", '["transcribe", { id: "cleanup", when: { condition: "c" } }, "judge"]'),
		);
		const err = quiet();
		try {
			expect(await exec(["run", "fx-optional", "--workdir", workdir])).toBe(2);
			expect(await exec(["run", "fx-when", "--workdir", workdir])).toBe(2);
			expect(err.mock.calls.flat().join(" ")).toContain("non-linear stage graph");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("non-asrText inputs resolve as lineage without relaxing transcribe", async () => {
		writeSuite(
			"fx-corrected",
			base(
				"fx-corrected",
				'["transcribe", "cleanup", "judge"]',
				', inputs: [{ suite: "fx", stage: "cleanup", field: "correctedText" }]',
			),
		);
		quiet();
		try {
			expect(await exec(["run", "fx-corrected", "--workdir", workdir])).toBe(0);
			const { evalStore } = storeReportLayers(workdir);
			const exps = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const s = yield* EvalStorePort;
						return yield* s.listExperiments({ suiteId: "fx-corrected" });
					}).pipe(Effect.provide(evalStore)),
				),
			);
			const exp = [...exps].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]!;
			expect(exp.derivedFrom).toHaveLength(1);
			const inputs = exp.summary.inputs as { ref: string }[];
			expect(inputs[0]!.ref).toBe("fx#cleanup.correctedText");
		} finally {
			vi.restoreAllMocks();
		}
	});

	test("duplicate sampleIds across asrText inputs: first manifest input wins", async () => {
		const { evalStore } = storeReportLayers(workdir);
		const exps = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const s = yield* EvalStorePort;
					return yield* s.listExperiments({ suiteId: "fx" });
				}).pipe(Effect.provide(evalStore)),
			),
		);
		const full = exps
			.filter((e) => e.kind === "run" && e.summary.samples === 2)
			.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]!;
		writeSuite(
			"fx-dupe",
			base(
				"fx-dupe",
				'["script_gen", "synthesize", "cleanup", "judge"]',
				`, inputs: [` +
					`{ suite: "fx", stage: "transcribe", runId: "${full.id}" }, ` +
					`{ suite: "fx", stage: "transcribe", runId: "run-lim" }]`,
			),
		);
		quiet();
		try {
			expect(await exec(["run", "fx-dupe", "--workdir", workdir])).toBe(0);
			const { evalStore: es2 } = storeReportLayers(workdir);
			const dExps = await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const s = yield* EvalStorePort;
						return yield* s.listExperiments({ suiteId: "fx-dupe" });
					}).pipe(Effect.provide(es2)),
				),
			);
			const d = [...dExps].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]!;
			expect(d.derivedFrom).toEqual([full.id, "run-lim"]);
		} finally {
			vi.restoreAllMocks();
		}
	});
});

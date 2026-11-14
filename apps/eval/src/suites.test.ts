import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { findSuite, listSuiteFiles, loadSuiteFile, loadSuites } from "./suites.ts";

let dir = "";

const write = (name: string, body: string) => {
	fs.writeFileSync(path.join(dir, name), body);
};

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-suites-"));
	write(
		"valid.suite.ts",
		`export const suite = {
			id: "valid",
			domain: "eval.consult",
			dataset: { id: "d", version: "v1" },
			stages: ["transcribe"],
			caps: {},
			metrics: [],
			gates: [],
			schemaVersion: 1,
		};
		export const helper = 1;`,
	);
	write("invalid.suite.ts", `export const suite = { nope: true };`);
	write("noexport.suite.ts", `export const other = 42;`);
	// Plain .ts helpers are NOT manifests — even one exporting a
	// `suite` field must be ignored by the loader (evals/ convention).
	write("helpers.ts", `export const suite = { nope: true };`);
	write("notes.txt", "not a suite");
	// P-075: manifests colocate with their domain pack — the loader
	// scans subdirectories recursively.
	fs.mkdirSync(path.join(dir, "pack"));
	fs.writeFileSync(
		path.join(dir, "pack", "nested.suite.ts"),
		`export const suite = { id: "nested", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [], schemaVersion: 1 };`,
	);
	fs.writeFileSync(path.join(dir, "pack", "helper.ts"), `export const x = 1;`);
	fs.mkdirSync(path.join(dir, "pack", "node_modules"));
	fs.writeFileSync(
		path.join(dir, "pack", "node_modules", "ignored.suite.ts"),
		`export const suite = 1;`,
	);
	fs.mkdirSync(path.join(dir, "pack", ".hidden"));
	fs.writeFileSync(path.join(dir, "pack", ".hidden", "hidden.suite.ts"), `export const suite = 1;`);
	// A symlink is neither dir nor file — skipped silently.
	fs.symlinkSync(path.join(dir, "valid.suite.ts"), path.join(dir, "pack", "link.suite.ts"));
});

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("listSuiteFiles", () => {
	test("returns sorted *.suite.ts files recursively, skipping helpers/node_modules/dot-dirs", () => {
		const files = listSuiteFiles(dir);
		expect(files.map((f) => path.basename(f))).toEqual([
			"invalid.suite.ts",
			"noexport.suite.ts",
			"nested.suite.ts",
			"valid.suite.ts",
		]);
		expect(files.find((f) => f.endsWith("nested.suite.ts"))).toContain(
			`${path.sep}pack${path.sep}`,
		);
	});

	test("missing dir is an error", () => {
		expect(() => listSuiteFiles(path.join(dir, "nope"))).toThrow(/not found/);
	});
});

describe("loadSuiteFile", () => {
	test("loads and validates a manifest", async () => {
		const s = await loadSuiteFile(path.join(dir, "valid.suite.ts"));
		expect(s.manifest.id).toBe("valid");
		expect(s.file).toContain("valid.suite.ts");
	});

	test("schema-invalid export is an error naming the file", async () => {
		await expect(loadSuiteFile(path.join(dir, "invalid.suite.ts"))).rejects.toThrow(
			/valid EvalSuiteManifest/,
		);
	});

	test("loads a manifest colocated in a domain subdirectory", async () => {
		const s = await loadSuiteFile(path.join(dir, "pack", "nested.suite.ts"));
		expect(s.manifest.id).toBe("nested");
	});

	test("missing suite export is an error", async () => {
		await expect(loadSuiteFile(path.join(dir, "noexport.suite.ts"))).rejects.toThrow(
			/valid EvalSuiteManifest/,
		);
	});

	test("import failure is an error naming the file", async () => {
		const bad = path.join(dir, "broken.suite.ts");
		fs.writeFileSync(bad, `throw new Error("boom");`);
		try {
			await expect(loadSuiteFile(bad)).rejects.toThrow(/failed to import suite/);
		} finally {
			fs.rmSync(bad);
		}
	});
});

describe("loadSuites / findSuite", () => {
	test("loadSuites rejects when any file is invalid", async () => {
		// invalid.suite.ts + noexport.suite.ts are in the dir — one bad file fails the batch.
		await expect(loadSuites(dir)).rejects.toThrow(/EvalSuiteManifest/);
	});

	test("findSuite resolves by id and lists known ids on miss", async () => {
		const good = fs.mkdtempSync(path.join(os.tmpdir(), "eval-suites-ok-"));
		fs.writeFileSync(
			path.join(good, "a.suite.ts"),
			`export const suite = { id: "alpha", domain: "d", dataset: { id: "d", version: "1" }, stages: [], caps: {}, metrics: [], gates: [], schemaVersion: 1 };`,
		);
		try {
			const s = await findSuite(good, "alpha");
			expect(s.manifest.id).toBe("alpha");
			await expect(findSuite(good, "beta")).rejects.toThrow(
				/unknown suite "beta" — available: alpha/,
			);
		} finally {
			fs.rmSync(good, { recursive: true, force: true });
		}
	});

	test("findSuite on an empty dir reports (none)", async () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "eval-suites-empty-"));
		try {
			await expect(findSuite(empty, "x")).rejects.toThrow(/\(none\)/);
		} finally {
			fs.rmSync(empty, { recursive: true, force: true });
		}
	});
});

describe("repo manifests", () => {
	test("the real evals/consultation/consult-asr.suite.ts loads through the same path", async () => {
		// exercises the defineSuite'd manifest end-to-end (dynamic import
		// of a workspace .ts under the repo root) — colocated inside its
		// domain pack since P-075.
		const repoEvals = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../evals");
		const suites = await loadSuites(repoEvals);
		expect(suites.map((s) => s.manifest.id)).toContain("consult-asr");
	});
});

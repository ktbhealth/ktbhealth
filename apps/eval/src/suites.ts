/**
 * suites.ts — evals/ manifest discovery (P-074 phase 4).
 *
 * Suite manifests are pure data validated by `defineSuite` at
 * definition time; this loader re-validates through
 * `validateManifest` so a hand-edited or stale file fails loudly
 * instead of composing garbage. Apps are the exempt edge — fs and
 * dynamic import of .ts are legal here (Bun runtime).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { validateManifest, type EvalSuiteManifest } from "@ktb/eval-core";

export interface LoadedSuite {
	readonly file: string;
	readonly manifest: EvalSuiteManifest;
}

/** The export name every suite module must provide. */
const SUITE_EXPORT = "suite";

const isSuiteFile = (name: string): boolean =>
	name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts");

/** Sorted `*.ts` suite files in `dir` (non-recursive). */
export const listSuiteFiles = (dir: string): readonly string[] => {
	if (!fs.existsSync(dir)) {
		throw new Error(`suite directory not found: ${dir}`);
	}
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isFile() && isSuiteFile(d.name))
		.map((d) => path.join(dir, d.name))
		.sort();
};

/** Import one suite module and validate its `suite` export. Any
 * failure — missing export, schema violation, import error — is a
 * hard error naming the file. */
export const loadSuiteFile = async (file: string): Promise<LoadedSuite> => {
	let mod: Record<string, unknown>;
	try {
		mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
	} catch (cause) {
		throw new Error(`failed to import suite ${file}: ${String(cause)}`, { cause });
	}
	const candidate = mod[SUITE_EXPORT] ?? mod.default;
	const manifest = validateManifest(candidate);
	if (manifest === null) {
		throw new Error(
			`suite ${file}: export "${SUITE_EXPORT}" is missing or not a valid EvalSuiteManifest`,
		);
	}
	return { file, manifest };
};

/** Load + validate every suite manifest in `dir`. */
export const loadSuites = async (dir: string): Promise<readonly LoadedSuite[]> =>
	Promise.all(listSuiteFiles(dir).map(loadSuiteFile));

/** Find one suite by manifest id; error lists what IS available. */
export const findSuite = async (dir: string, id: string): Promise<LoadedSuite> => {
	const suites = await loadSuites(dir);
	const hit = suites.find((s) => s.manifest.id === id);
	if (hit === undefined) {
		const known = suites.map((s) => s.manifest.id).join(", ") || "(none)";
		throw new Error(`unknown suite "${id}" — available: ${known}`);
	}
	return hit;
};

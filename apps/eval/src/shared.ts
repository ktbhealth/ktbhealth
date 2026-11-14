/**
 * helpers shared by the suite commands (P-074 phase 4): profile
 * selection, manifest resolution, and the workdir scratch-path guard
 * ported from packages/eval-dataset-local/scripts/generate.ts.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { BatchOutcome, EvalSuiteManifest, PortError } from "@ktb/eval-core";

import { strFlag, UsageError, type ParsedArgs } from "./args.ts";
import { buildRegistry } from "./contributions.ts";
import { knownProfiles, resolveSuite, type SuiteResolution } from "./resolve.ts";
import type { LoadedSuite } from "./suites.ts";

/** datasetVersion stamped on generated samples and used to select
 * them at run time — derived from the manifest's dataset pin so the
 * suite declares its cohort. */
export const datasetVersionOf = (manifest: EvalSuiteManifest): string =>
	`${manifest.dataset.id}-${manifest.dataset.version}`;

/** `--profile` flag → manifest.adapterProfile → "stub". Unknown
 * profiles are a usage error listing the known set. */
export const selectProfile = (args: ParsedArgs, suite: LoadedSuite): string => {
	const profile = strFlag(args, "profile") ?? suite.manifest.adapterProfile ?? "stub";
	if (!knownProfiles().includes(profile)) {
		throw new UsageError(`unknown --profile "${profile}" (known: ${knownProfiles().join(", ")})`);
	}
	return profile;
};

export interface ResolvedCommand {
	readonly profile: string;
	readonly resolution: SuiteResolution;
}

/** Resolve the suite's contributions under the selected profile. */
export const resolveFor = (suite: LoadedSuite, profile: string): ResolvedCommand => ({
	profile,
	resolution: resolveSuite(buildRegistry(), suite.manifest, profile),
});

/** Fail when any of `needed` capability ids is unresolved — the
 * error names every missing ref so one run shows the whole gap. */
export const assertCapabilities = (
	suite: LoadedSuite,
	resolution: SuiteResolution,
	needed: readonly string[],
): void => {
	const missing = resolution.unresolved.filter((u) => needed.includes(u.id));
	if (missing.length > 0) {
		throw new Error(
			`suite "${suite.manifest.id}" profile resolution incomplete: ` +
				missing.map((u) => `${u.kind} "${u.id}" (${u.reason})`).join("; "),
		);
	}
};

export const workdirFlag = (args: ParsedArgs): string => {
	const workdir = strFlag(args, "workdir", path.join(os.tmpdir(), "eval-app"))!;
	// Same scratch-path guard as scripts/generate.ts — a bad argv must
	// not write into a real directory. Must be under os.tmpdir() or
	// <cwd>/tmp.
	const resolved = path.resolve(workdir);
	const scratchRoots = [
		path.resolve(os.tmpdir()),
		fs.realpathSync(os.tmpdir()),
		path.resolve(process.cwd(), "tmp"),
	];
	const isScratch = scratchRoots.some(
		(r) => resolved === r || resolved.startsWith(`${r}${path.sep}`),
	);
	if (!isScratch) {
		throw new UsageError(`--workdir must live under ${scratchRoots.join(" or ")}, got: ${workdir}`);
	}
	return resolved;
};

/** Human mark for one batch outcome — shared by generate/run so the
 * ok/failed/timeout rendering stays identical. `ok` renders the
 * success value (generate ignores it, run prints WER). */
export const outcomeMark = <I, A>(
	o: BatchOutcome<I, A, PortError>,
	ok: (value: A) => string,
): string => {
	if (o.status === "ok") return ok(o.value as A);
	/* v8 ignore next -- a timeout needs a step slower than timeoutMs;
	 * not exercisable with the fast stub/local adapters in tests */
	if (o.status === "timeout") return "TIMEOUT";
	return `FAIL ${o.error!.message}`;
};

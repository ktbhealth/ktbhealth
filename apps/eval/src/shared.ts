/**
 * helpers shared by the suite commands: profile selection, manifest
 * resolution, flag decoding and the workdir scratch-path guard
 * (ported from the retired eval-adapter-local scripts).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { Option } from "effect";
import { CliError } from "effect/cli";

import type { BatchOutcome, EvalSuiteManifest } from "@ktb/eval-core";
import { PortError } from "@ktb/eval-core";
import { ptBR, type LocaleProfile } from "@ktb/eval-consultation";

import { buildRegistry } from "./contributions.ts";
import { UsageError } from "./errors.ts";
import { knownProfiles, resolveSuite, type SuiteResolution } from "./resolve.ts";
import type { LoadedSuite } from "./suites.ts";

/** datasetVersion stamped on generated samples and used to select
 * them at run time — derived from the manifest's dataset pin so the
 * suite declares its cohort. */
export const datasetVersionOf = (manifest: EvalSuiteManifest): string =>
	`${manifest.dataset.id}-${manifest.dataset.version}`;

/** locale name → LocaleProfile — the single registry `generate` and
 * `run` both resolve `--locale` through (scripts/templates are
 * locale-keyed, so the flag must agree across the pair). */
const LOCALES: Record<string, LocaleProfile> = { "pt-BR": ptBR };

/** Resolve `--locale` (default pt-BR) — unknown names are a usage
 * error listing the known set. Shared by generate/run. */
export const localeFlag = Effect.fnUntraced(function* (
	locale: Option.Option<string>,
): Effect.fn.Return<LocaleProfile, UsageError> {
	const name = Option.getOrElse(locale, () => "pt-BR");
	const profile = LOCALES[name];
	if (profile === undefined) {
		return yield* new UsageError({
			message: `unknown --locale ${name} (available: ${Object.keys(LOCALES).join(", ")})`,
		});
	}
	return profile;
});

/** runBatch retry predicate — deterministic domain failures (PHI
 * refusals, corrupt payloads, render errors) can never succeed on
 * retry; only transient adapter failures (network, 5xx, timeouts)
 * should burn the schedule. Pass as `options.retryWhile`. */
export const isTransientBatchError = (e: unknown): boolean =>
	!(e instanceof PortError && (e.port === "phi" || e.port === "pipeline" || e.port === "generate"));

/** Wrap an arbitrary failure as a user-facing CLI error (exit 1) —
 * Command.run renders `cause.message` through the CliOutput
 * formatter. */
export const userError = (cause: unknown): CliError.UserError =>
	new CliError.UserError({
		/* v8 ignore next 4 -- tryPromise/try rejections in this app are
		 * always Error instances; the String() fallback is defensive */
		cause: cause instanceof Error ? cause : new Error(String(cause)),
	});

/** `--profile` flag → manifest.adapterProfile → "stub". Unknown
 * profiles are a usage error listing the known set. */
export const selectProfile = Effect.fnUntraced(function* (
	profile: Option.Option<string>,
	suite: LoadedSuite,
): Effect.fn.Return<string, UsageError> {
	const p = Option.getOrElse(profile, () => suite.manifest.adapterProfile ?? "stub");
	if (!knownProfiles().includes(p)) {
		return yield* new UsageError({
			message: `unknown --profile "${p}" (known: ${knownProfiles().join(", ")})`,
		});
	}
	return p;
});

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
export const assertCapabilities = Effect.fnUntraced(function* (
	suite: LoadedSuite,
	resolution: SuiteResolution,
	needed: readonly string[],
): Effect.fn.Return<void, CliError.UserError> {
	const missing = resolution.unresolved.filter((u) => needed.includes(u.id));
	if (missing.length > 0) {
		return yield* userError(
			new Error(
				`suite "${suite.manifest.id}" profile resolution incomplete: ` +
					missing.map((u) => `${u.kind} "${u.id}" (${u.reason})`).join("; "),
			),
		);
	}
});

/** Optional int flag with default + floor — Flag.Int already rejects
 * non-integers at parse time; this enforces the minimum, but only
 * when the flag was actually passed (the default may sit below the
 * floor, e.g. `--limit`'s "unset" sentinel). */
export const intFlag = Effect.fnUntraced(function* (
	name: string,
	value: Option.Option<number>,
	def: number,
	min: number,
): Effect.fn.Return<number, UsageError> {
	if (Option.isSome(value) && (!Number.isInteger(value.value) || value.value < min)) {
		return yield* new UsageError({
			message: `--${name} must be an integer >= ${min}, got: ${value.value}`,
		});
	}
	return Option.getOrElse(value, () => def);
});

/** `--workdir` flag → resolved scratch path. Same guard as the
 * retired scripts: must live under os.tmpdir() or <cwd>/tmp so a bad
 * argv cannot write into a real directory. */
export const workdirFlag = Effect.fnUntraced(function* (
	workdir: Option.Option<string>,
): Effect.fn.Return<string, UsageError> {
	const raw = Option.getOrElse(workdir, () => path.join(os.tmpdir(), "eval-app"));
	const resolved = path.resolve(raw);
	const scratchRoots = [
		path.resolve(os.tmpdir()),
		fs.realpathSync(os.tmpdir()),
		path.resolve(process.cwd(), "tmp"),
	];
	const isScratch = scratchRoots.some(
		(r) => resolved === r || resolved.startsWith(`${r}${path.sep}`),
	);
	if (!isScratch) {
		return yield* new UsageError({
			message: `--workdir must live under ${scratchRoots.join(" or ")}, got: ${raw}`,
		});
	}
	return resolved;
});

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

/**
 * list — scan evals/, validate manifests, resolve contributions.
 *
 *   eval list [--dir <path>] [--strict] [--workdir d]
 *
 * The CI-checkable command: every suite's refs are resolved against
 * the built ContributionRegistry under its declared adapterProfile.
 * Unresolved refs are printed, not hidden; --strict exits 1 when any
 * suite has one.
 *
 * Dataset registry check (P-076): when --workdir is given, each
 * suite's `dataset {id, version}` pin is looked up in that workdir's
 * EvalStorePort — a suite whose dataset was never `eval generate`d
 * (or was generated under a different version) prints a `! dataset`
 * line and counts toward --strict failure. WITHOUT --workdir the
 * check is skipped with a note: datasets live in per-workdir stores,
 * so there is no global registry to consult — strict still covers
 * contribution refs only. This is deliberate: `eval list` stays
 * runnable with zero generated state.
 */

import * as Effect from "effect/Effect";
import { Console, Option } from "effect";
import { Command, Flag } from "effect/cli";

import { EvalStorePort } from "@ktb/eval-core";

import { storeReportLayers } from "../adapters.ts";
import { CommandExit } from "../errors.ts";
import { buildRegistry } from "../contributions.ts";
import { resolveSuite } from "../resolve.ts";
import { loadSuites } from "../suites.ts";
import { userError, workdirFlag } from "../shared.ts";
import type { CmdContext } from "../context.ts";

const group = <T extends { kind: string }>(items: readonly T[], kind: string): T[] =>
	items.filter((i) => i.kind === kind);

/** Display label for a contribution kind — the `eval.` namespace is
 * registry plumbing, not something suite authors need to read. */
const kindLabel = (kind: string): string => kind.replace(/^eval\./, "");

export const makeListCommand = (ctx: CmdContext) =>
	Command.make(
		"list",
		{
			dir: Flag.optional(Flag.String("dir")),
			strict: Flag.Boolean("strict").pipe(Flag.withDefault(false)),
			workdir: Flag.optional(Flag.String("workdir")),
		},
		(cfg) =>
			Effect.gen(function* () {
				const dir = Option.getOrElse(cfg.dir, () => ctx.evalsDir);
				const registry = buildRegistry();
				const suites = yield* Effect.tryPromise({
					try: () => loadSuites(dir),
					catch: userError,
				});
				if (suites.length === 0) {
					yield* Console.log(`no suite manifests in ${dir}`);
					return;
				}

				// Dataset registry check — only meaningful against a
				// concrete store (--workdir). See module header.
				const workdir = yield* workdirFlag(cfg.workdir);
				const hasWorkdir = Option.isSome(cfg.workdir);
				const evalStore = hasWorkdir ? storeReportLayers(workdir).evalStore : undefined;

				let unresolvedTotal = 0;
				let datasetMissing = 0;
				for (const { file, manifest } of suites) {
					const profile = manifest.adapterProfile ?? "stub";
					const res = resolveSuite(registry, manifest, profile);
					unresolvedTotal += res.unresolved.length;
					const adapters = Object.entries(res.adapters)
						.map(([cap, key]) => `${cap}=${key}`)
						.join(" ");
					yield* Console.log(`${manifest.id} — ${file}`);
					yield* Console.log(
						`  domain ${manifest.domain} · dataset ${manifest.dataset.id}@${manifest.dataset.version}` +
							` · schema v${manifest.schemaVersion} · profile ${profile}`,
					);
					const counts = (kind: string, n: number) => {
						const r = group(res.resolved, kind).length;
						const u = group(res.unresolved, kind).length;
						return `${kindLabel(kind).padEnd(11)} ${r}/${n} resolved${u > 0 ? `, ${u} unresolved` : ""}`;
					};
					yield* Console.log(`  ${counts("eval.stage", manifest.stages.length)}`);
					yield* Console.log(`  ${counts("eval.metric", manifest.metrics.length)}`);
					yield* Console.log(`  ${counts("eval.gate", manifest.gates.length)}`);
					yield* Console.log(`  ${counts("eval.capability", Object.keys(manifest.caps).length)}`);
					if (adapters !== "") yield* Console.log(`  adapters  ${adapters}`);
					for (const u of res.unresolved) {
						yield* Console.log(`  ! ${kindLabel(u.kind)} "${u.id}" — ${u.reason}`);
					}

					if (evalStore !== undefined) {
						const registered = yield* Effect.scoped(
							Effect.gen(function* () {
								const s = yield* EvalStorePort;
								return yield* s.getDatasetManifest(manifest.dataset.id, manifest.dataset.version);
							}).pipe(Effect.provide(evalStore)),
						);
						if (registered === null) {
							datasetMissing++;
							yield* Console.log(
								`  ! dataset "${manifest.dataset.id}@${manifest.dataset.version}" — ` +
									`no DatasetManifest under ${workdir} (run eval generate first)`,
							);
						} else {
							yield* Console.log(
								`  dataset  ${registered.id}@${registered.version} registered ` +
									`(${registered.sampleCount} samples, hash ${registered.contentHash.slice(0, 12)}…)`,
							);
						}
					}
					yield* Console.log("");
				}

				yield* Console.log(
					`${suites.length} suite(s), ${unresolvedTotal} unresolved ref(s)` +
						(datasetMissing > 0 ? `, ${datasetMissing} missing dataset(s)` : "") +
						` in ${dir}`,
				);
				if (!hasWorkdir && cfg.strict) {
					yield* Console.log(
						"note: dataset registry check skipped — pass --workdir to validate dataset pins",
					);
				}
				if (cfg.strict && (unresolvedTotal > 0 || datasetMissing > 0)) {
					return yield* new CommandExit({ code: 1 });
				}
			}),
	).pipe(
		Command.withDescription(
			"Scan suite manifests, validate, resolve contributions (+ dataset registry check with --workdir).",
		),
	);

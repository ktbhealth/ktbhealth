/**
 * list — scan evals/, validate manifests, resolve contributions.
 *
 *   eval list [--dir <path>] [--strict]
 *
 * The CI-checkable command: every suite's refs are resolved against
 * the built ContributionRegistry under its declared adapterProfile.
 * Unresolved refs are printed, not hidden; --strict exits 1 when any
 * suite has one.
 */

import * as Effect from "effect/Effect";
import { Console, Option } from "effect";
import { Command, Flag } from "effect/cli";

import { CommandExit } from "../errors.ts";
import { buildRegistry } from "../contributions.ts";
import { resolveSuite } from "../resolve.ts";
import { loadSuites } from "../suites.ts";
import { userError } from "../shared.ts";
import type { CmdContext } from "../context.ts";

const group = <T extends { kind: string }>(items: readonly T[], kind: string): T[] =>
	items.filter((i) => i.kind === kind);

export const makeListCommand = (ctx: CmdContext) =>
	Command.make(
		"list",
		{
			dir: Flag.optional(Flag.String("dir")),
			strict: Flag.Boolean("strict").pipe(Flag.withDefault(false)),
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

				let unresolvedTotal = 0;
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
						return `${kind.padEnd(11)} ${r}/${n} resolved${u > 0 ? `, ${u} unresolved` : ""}`;
					};
					yield* Console.log(`  ${counts("stage", manifest.stages.length)}`);
					yield* Console.log(`  ${counts("metric", manifest.metrics.length)}`);
					yield* Console.log(`  ${counts("gate", manifest.gates.length)}`);
					yield* Console.log(`  ${counts("capability", Object.keys(manifest.caps).length)}`);
					if (adapters !== "") yield* Console.log(`  adapters  ${adapters}`);
					for (const u of res.unresolved) {
						yield* Console.log(`  ! ${u.kind} "${u.id}" — ${u.reason}`);
					}
					yield* Console.log("");
				}

				yield* Console.log(
					`${suites.length} suite(s), ${unresolvedTotal} unresolved ref(s) in ${dir}`,
				);
				if (cfg.strict && unresolvedTotal > 0) {
					return yield* new CommandExit({ code: 1 });
				}
			}),
	).pipe(Command.withDescription("Scan suite manifests, validate, resolve contributions."));

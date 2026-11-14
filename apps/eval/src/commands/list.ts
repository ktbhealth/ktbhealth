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

import { boolFlag, parseArgs, strFlag } from "../args.ts";
import { buildRegistry } from "../contributions.ts";
import { resolveSuite } from "../resolve.ts";
import { loadSuites } from "../suites.ts";
import type { CmdContext } from "../context.ts";

const group = <T extends { kind: string }>(items: readonly T[], kind: string): T[] =>
	items.filter((i) => i.kind === kind);

export const listCommand = async (argv: readonly string[], ctx: CmdContext): Promise<number> => {
	const args = parseArgs(argv, {
		flags: { dir: "string", strict: "boolean" },
	});
	const dir = strFlag(args, "dir", ctx.evalsDir)!;
	const strict = boolFlag(args, "strict");

	const registry = buildRegistry();
	const suites = await loadSuites(dir);
	if (suites.length === 0) {
		console.log(`no suite manifests in ${dir}`);
		return 0;
	}

	let unresolvedTotal = 0;
	for (const { file, manifest } of suites) {
		const profile = manifest.adapterProfile ?? "stub";
		const res = resolveSuite(registry, manifest, profile);
		unresolvedTotal += res.unresolved.length;
		const adapters = Object.entries(res.adapters)
			.map(([cap, key]) => `${cap}=${key}`)
			.join(" ");
		console.log(`${manifest.id} — ${file}`);
		console.log(
			`  domain ${manifest.domain} · dataset ${manifest.dataset.id}@${manifest.dataset.version}` +
				` · schema v${manifest.schemaVersion} · profile ${profile}`,
		);
		const counts = (kind: string, n: number) => {
			const r = group(res.resolved, kind).length;
			const u = group(res.unresolved, kind).length;
			console.log(`  ${kind.padEnd(11)} ${r}/${n} resolved${u > 0 ? `, ${u} unresolved` : ""}`);
		};
		counts("stage", manifest.stages.length);
		counts("metric", manifest.metrics.length);
		counts("gate", manifest.gates.length);
		counts("capability", Object.keys(manifest.caps).length);
		if (adapters !== "") console.log(`  adapters  ${adapters}`);
		for (const u of res.unresolved) {
			console.log(`  ! ${u.kind} "${u.id}" — ${u.reason}`);
		}
		console.log("");
	}

	console.log(`${suites.length} suite(s), ${unresolvedTotal} unresolved ref(s) in ${dir}`);
	return strict && unresolvedTotal > 0 ? 1 : 0;
};

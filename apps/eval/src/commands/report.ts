/**
 * report — render a persisted run's records + result summary
 * (P-074 phase 4).
 *
 *   eval report <suite> [--workdir d] [--run-id id]
 *
 * Without --run-id the most recent runId in the store is rendered
 * (max SampleResult.createdAt). Output is the ReportPort markdown
 * (renderRunMarkdown — the port contract) plus a one-line cohort
 * summary.
 */

import * as Effect from "effect/Effect";

import { DatasetStorePort, ReportPort } from "@ktb/eval-consult";

import { parseArgs, strFlag } from "../args.ts";
import { storeReportLayers } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { findSuite } from "../suites.ts";
import { workdirFlag } from "../shared.ts";

const SPEC = {
	positionals: ["suite"],
	flags: { workdir: "string", "run-id": "string" },
} as const;

export const reportCommand = async (argv: readonly string[], ctx: CmdContext): Promise<number> => {
	const args = parseArgs(argv, SPEC);
	// Validate the suite exists even though the report renders stored
	// data — a typo'd suite id should fail, not render a stranger's run.
	await findSuite(ctx.evalsDir, args.positional.suite!);
	const workdir = workdirFlag(args);
	const { store, report } = storeReportLayers(workdir);

	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const s = yield* DatasetStorePort;
			return yield* s.listResults();
		}).pipe(Effect.provide(store)),
	);
	if (results.length === 0) {
		console.log(`no results under ${workdir} — nothing to report`);
		return 0;
	}

	const runId =
		strFlag(args, "run-id") ?? results.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).runId;
	const forRun = results.filter((r) => r.runId === runId);

	const markdown = await Effect.runPromise(
		Effect.gen(function* () {
			const r = yield* ReportPort;
			return yield* r.render(runId);
		}).pipe(Effect.provide(report)),
	);

	const meanWer =
		forRun.length === 0
			? null
			: forRun.reduce((acc, r) => acc + (r.correctedMetrics?.wer ?? 0), 0) / forRun.length;
	console.log(markdown);
	console.log(
		`run ${runId}: ${forRun.length} result(s)` +
			(meanWer !== null ? `, mean corrected WER ${meanWer.toFixed(3)}` : ""),
	);
	return 0;
};

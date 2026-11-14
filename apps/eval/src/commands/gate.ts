/**
 * gate — apply a suite's declared gates to persisted results
 * (P-074 phase 4).
 *
 *   eval gate <suite> [--workdir d] [--run-id id] [--enforce]
 *     [--stage asr|corrected] [--max-wer n] [--target n] [--min-n n]
 *     [--max-risk n] [--max-harmful-edits n] [--max-unjudged-edits n]
 *     [--z n]
 *
 * Each manifest gate's params decode to an AcceptPolicy
 * (policy.ts); CLI flags override individual fields. Without
 * --enforce this is a report (exit 0); with it, any red gate exits 1
 * — the CI hook. Empty result sets are "nothing to gate", exit 0.
 */

import * as Effect from "effect/Effect";

import { DatasetStorePort, decideAutoAccept, gateRun, type AcceptPolicy } from "@ktb/eval-consult";

import { parseArgs, strFlag, UsageError } from "../args.ts";
import { storeReportLayers } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { GATE_DECODERS, POLICY_FLAGS } from "../policy.ts";
import { findSuite } from "../suites.ts";
import { workdirFlag } from "../shared.ts";

const SPEC = {
	positionals: ["suite"],
	flags: {
		workdir: "string",
		"run-id": "string",
		enforce: "boolean",
		stage: "string",
		"max-wer": "number",
		target: "number",
		"min-n": "int",
		"max-risk": "number",
		"max-harmful-edits": "number",
		"max-unjudged-edits": "number",
		z: "number",
	},
} as const;

/** CLI flag → AcceptPolicy field overrides. Only fields present on
 * the command line override the manifest params. */
const applyOverrides = (
	policy: AcceptPolicy,
	flags: Readonly<Record<string, string | number | boolean | undefined>>,
): AcceptPolicy => {
	const out: { -readonly [K in keyof AcceptPolicy]?: AcceptPolicy[K] } = { ...policy };
	for (const [field, flag] of Object.entries(POLICY_FLAGS)) {
		const v = flags[flag];
		if (v === undefined) continue;
		if (field === "stage") {
			if (v !== "asr" && v !== "corrected") {
				throw new UsageError(`--stage must be "asr" or "corrected", got: ${String(v)}`);
			}
			out.stage = v;
		} else {
			(out as Record<string, unknown>)[field] = v;
		}
	}
	return out as AcceptPolicy;
};

export const gateCommand = async (argv: readonly string[], ctx: CmdContext): Promise<number> => {
	const args = parseArgs(argv, SPEC);
	const suite = await findSuite(ctx.evalsDir, args.positional.suite!);
	const manifest = suite.manifest;
	const workdir = workdirFlag(args);
	const runId = strFlag(args, "run-id");

	const { store } = storeReportLayers(workdir);
	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const s = yield* DatasetStorePort;
			return yield* s.listResults(runId !== undefined ? { runId } : undefined);
		}).pipe(Effect.provide(store)),
	);
	if (results.length === 0) {
		console.log(`no results under ${workdir}${runId !== undefined ? ` for run ${runId}` : ""}`);
		return 0;
	}

	let anyRed = false;
	manifest.gates.forEach((gate, gi) => {
		const decode = GATE_DECODERS[gate.id];
		if (decode === undefined) {
			throw new Error(`gate "${gate.id}" is registered but has no runner in apps/eval (policy.ts)`);
		}
		const policy = applyOverrides(decode(gate.params, gate.id), args.flags);
		const gateResult = gateRun(results, policy);
		anyRed ||= !gateResult.green;
		console.log(
			`gate ${gate.id} (${gi + 1}/${manifest.gates.length}): ` +
				`${gateResult.accepted}/${results.length} accepted — ${gateResult.green ? "GREEN" : "RED"}`,
		);
		for (const r of gateResult.rejected) {
			console.log(`  REJECT ${r.id}: ${r.reasons.join("; ")}`);
		}
		// Per-sample verdict detail for the first gate only — later
		// gates get the aggregate (keeps output readable).
		if (gi === 0) {
			for (const result of results) {
				const d = decideAutoAccept(result, policy);
				const mark = d.accept ? "accept" : `REJECT — ${d.reasons.join("; ")}`;
				console.log(`  ${result.sampleId}: ${mark}`);
			}
		}
	});

	const enforce = args.flags.enforce === true;
	if (enforce && anyRed) {
		console.log("gate: RED under --enforce");
		return 1;
	}
	return 0;
};

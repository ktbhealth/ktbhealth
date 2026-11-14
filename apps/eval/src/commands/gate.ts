/**
 * gate — apply a suite's declared gates to persisted results.
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
import { Console, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { DatasetStorePort, decideAutoAccept, gateRun, type AcceptPolicy } from "@ktb/eval-consult";

import { storeReportLayers } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { CommandExit, UsageError } from "../errors.ts";
import { GATE_DECODERS } from "../policy.ts";
import { findSuite } from "../suites.ts";
import { userError, workdirFlag } from "../shared.ts";

const optStr = Option.getOrUndefined;
const optNum = Option.getOrUndefined;

/** CLI flag → AcceptPolicy field overrides. Only fields present on
 * the command line override the manifest params. */
const applyOverrides = (
	policy: AcceptPolicy,
	flags: {
		readonly stage: Option.Option<string>;
		readonly maxWer: Option.Option<number>;
		readonly target: Option.Option<number>;
		readonly minN: Option.Option<number>;
		readonly maxRisk: Option.Option<number>;
		readonly maxHarmfulEdits: Option.Option<number>;
		readonly maxUnjudgedEdits: Option.Option<number>;
		readonly z: Option.Option<number>;
	},
): Effect.Effect<AcceptPolicy, UsageError> =>
	Effect.suspend(() => {
		const stage = optStr(flags.stage);
		if (stage !== undefined && stage !== "asr" && stage !== "corrected") {
			return Effect.fail(
				new UsageError({ message: `--stage must be "asr" or "corrected", got: ${stage}` }),
			);
		}
		const out: { -readonly [K in keyof AcceptPolicy]?: AcceptPolicy[K] } = { ...policy };
		if (stage !== undefined) out.stage = stage;
		const nums = {
			maxWer: optNum(flags.maxWer),
			target: optNum(flags.target),
			minN: optNum(flags.minN),
			maxRisk: optNum(flags.maxRisk),
			maxHarmfulEdits: optNum(flags.maxHarmfulEdits),
			maxUnjudgedEdits: optNum(flags.maxUnjudgedEdits),
			z: optNum(flags.z),
		} as const;
		for (const [field, v] of Object.entries(nums)) {
			if (v !== undefined) {
				(out as Record<string, unknown>)[field] = v;
			}
		}
		return Effect.succeed(out as AcceptPolicy);
	});

export const makeGateCommand = (ctx: CmdContext) =>
	Command.make(
		"gate",
		{
			suite: Argument.String("suite"),
			workdir: Flag.optional(Flag.String("workdir")),
			runId: Flag.optional(Flag.String("run-id")),
			enforce: Flag.Boolean("enforce").pipe(Flag.withDefault(false)),
			stage: Flag.optional(Flag.String("stage")),
			maxWer: Flag.optional(Flag.Finite("max-wer")),
			target: Flag.optional(Flag.Finite("target")),
			minN: Flag.optional(Flag.Int("min-n")),
			maxRisk: Flag.optional(Flag.Finite("max-risk")),
			maxHarmfulEdits: Flag.optional(Flag.Finite("max-harmful-edits")),
			maxUnjudgedEdits: Flag.optional(Flag.Finite("max-unjudged-edits")),
			z: Flag.optional(Flag.Finite("z")),
		},
		(cfg) =>
			Effect.gen(function* () {
				const suite = yield* Effect.tryPromise({
					try: () => findSuite(ctx.evalsDir, cfg.suite),
					catch: userError,
				});
				const manifest = suite.manifest;
				const workdir = yield* workdirFlag(cfg.workdir);
				const runId = optStr(cfg.runId);

				const { store } = storeReportLayers(workdir);
				const results = yield* Effect.scoped(
					Effect.gen(function* () {
						const s = yield* DatasetStorePort;
						return yield* s.listResults(runId !== undefined ? { runId } : undefined);
					}).pipe(Effect.provide(store)),
				);
				if (results.length === 0) {
					yield* Console.log(
						`no results under ${workdir}${runId !== undefined ? ` for run ${runId}` : ""}`,
					);
					return;
				}

				let anyRed = false;
				for (const [gi, gate] of manifest.gates.entries()) {
					const decode = GATE_DECODERS[gate.id];
					if (decode === undefined) {
						return yield* userError(
							new Error(
								`gate "${gate.id}" is registered but has no runner in apps/eval (policy.ts)`,
							),
						);
					}
					// decodeAcceptPolicy's contract is UsageError-only
					// throws (policy.ts) — lift it into the error channel
					// so the exit-2 mapping survives.
					const decoded = yield* Effect.try({
						try: () => decode(gate.params, gate.id),
						catch: (e) => e as UsageError,
					});
					const policy = yield* applyOverrides(decoded, {
						stage: cfg.stage,
						maxWer: cfg.maxWer,
						target: cfg.target,
						minN: cfg.minN,
						maxRisk: cfg.maxRisk,
						maxHarmfulEdits: cfg.maxHarmfulEdits,
						maxUnjudgedEdits: cfg.maxUnjudgedEdits,
						z: cfg.z,
					});
					const gateResult = gateRun(results, policy);
					anyRed ||= !gateResult.green;
					yield* Console.log(
						`gate ${gate.id} (${gi + 1}/${manifest.gates.length}): ` +
							`${gateResult.accepted}/${results.length} accepted — ${gateResult.green ? "GREEN" : "RED"}`,
					);
					for (const r of gateResult.rejected) {
						yield* Console.log(`  REJECT ${r.id}: ${r.reasons.join("; ")}`);
					}
					// Per-sample verdict detail for the first gate only —
					// later gates get the aggregate (keeps output readable).
					if (gi === 0) {
						for (const result of results) {
							const d = decideAutoAccept(result, policy);
							const mark = d.accept ? "accept" : `REJECT — ${d.reasons.join("; ")}`;
							yield* Console.log(`  ${result.sampleId}: ${mark}`);
						}
					}
				}

				if (cfg.enforce && anyRed) {
					yield* Console.log("gate: RED under --enforce");
					return yield* new CommandExit({ code: 1 });
				}
			}),
	).pipe(Command.withDescription("Apply the suite's declared gates to persisted results."));

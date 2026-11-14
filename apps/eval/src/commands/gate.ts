/**
 * gate — apply a suite's declared gates to persisted results.
 *
 *   eval gate <suite> [--workdir d] [--run-id id] [--enforce]
 *     [--stage asr|corrected] [--max-wer n] [--target n] [--min-n n]
 *     [--max-risk n] [--max-harmful-edits n] [--max-unjudged-edits n]
 *     [--z n]
 *
 * Each manifest gate's params decode to an AcceptPolicy
 * (policy.ts); CLI flags override individual fields — every numeric
 * override is range-checked against the same rules as manifest params
 * (policyNumberError), so `--target 5` or `--z -1` is a usage error,
 * never a silently-weakened gate. Results are scoped to the manifest's
 * dataset pin (SampleResult.datasetVersion) — a shared workdir holding
 * other suites' runs must not leak into this gate. Without --enforce
 * this is a report (exit 0); with it, any red gate exits 1 — the CI
 * hook. An EMPTY scoped result set is vacuous: exit 0 as a report,
 * exit 1 under --enforce (an empty run is not evidence — same rule as
 * gateRun's `results.length > 0` green condition).
 */

import * as Effect from "effect/Effect";
import { Console, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import { DatasetStorePort, decideAutoAccept, gateRun, type AcceptPolicy } from "@ktb/eval-consult";

import { storeReportLayers } from "../adapters.ts";
import type { CmdContext } from "../context.ts";
import { CommandExit, UsageError } from "../errors.ts";
import { GATE_DECODERS, policyNumberError } from "../policy.ts";
import { findSuite } from "../suites.ts";
import { datasetVersionOf, userError, workdirFlag } from "../shared.ts";

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
		// field → CLI flag name, for error messages.
		const nums = {
			maxWer: [optNum(flags.maxWer), "max-wer"],
			target: [optNum(flags.target), "target"],
			minN: [optNum(flags.minN), "min-n"],
			maxRisk: [optNum(flags.maxRisk), "max-risk"],
			maxHarmfulEdits: [optNum(flags.maxHarmfulEdits), "max-harmful-edits"],
			maxUnjudgedEdits: [optNum(flags.maxUnjudgedEdits), "max-unjudged-edits"],
			z: [optNum(flags.z), "z"],
		} as const;
		for (const [field, [v, flag]] of Object.entries(nums)) {
			if (v === undefined) continue;
			// Same range rules as manifest params — an override that
			// would weaken the gate (negative budgets, z <= 0, target
			// outside [0,1]) is a usage error, not a quiet pass.
			const err = policyNumberError(field, v);
			if (err !== null) {
				return Effect.fail(new UsageError({ message: `--${flag} ${err}` }));
			}
			(out as Record<string, unknown>)[field] = v;
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

				// Decode + override every declared gate BEFORE touching
				// the store: a malformed gate or out-of-range flag is a
				// usage error regardless of whether results exist.
				const gates: {
					readonly gate: (typeof manifest.gates)[number];
					readonly policy: AcceptPolicy;
				}[] = [];
				for (const gate of manifest.gates) {
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
					gates.push({ gate, policy });
				}

				const { store } = storeReportLayers(workdir);
				const all = yield* Effect.scoped(
					Effect.gen(function* () {
						const s = yield* DatasetStorePort;
						return yield* s.listResults(runId !== undefined ? { runId } : undefined);
					}).pipe(Effect.provide(store)),
				);
				// Scope to THIS suite's dataset pin — the workdir is shared
				// across suites/versions, and gating another suite's
				// results against this manifest's policy is meaningless.
				// Results without a datasetVersion stamp predate
				// attribution and cannot be claimed by any suite.
				const datasetVersion = datasetVersionOf(manifest);
				const results = all.filter((r) => r.datasetVersion === datasetVersion);
				if (results.length === 0) {
					yield* Console.log(
						`no results for dataset "${datasetVersion}" under ${workdir}` +
							(runId !== undefined ? ` (run ${runId})` : "") +
							(all.length > 0 ? ` — ${all.length} result(s) belong to other datasets` : ""),
					);
					if (cfg.enforce) {
						yield* Console.log("gate: no evidence to gate — RED under --enforce");
						return yield* new CommandExit({ code: 1 });
					}
					return;
				}

				let anyRed = false;
				for (const [gi, { gate, policy }] of gates.entries()) {
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

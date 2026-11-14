import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";

import { BatchDefect } from "./batch.ts";
import type { ConfigValidation, ContributionWithConfig } from "./registry.ts";
import { stageNodesOf, type StageEntry, type StageNode } from "./suite.ts";

/**
 * dag.ts — generic stage-DAG planning + scheduling (P-077).
 *
 * A suite manifest's `stages` entries form a directed acyclic graph:
 * nodes are registered stage ids, edges are declared `needs`. This
 * module owns the DOMAIN-BLIND half — graph validation, topological
 * leveling, bounded concurrent scheduling, condition guards, and
 * provenance (parents/branch) — while the domain pack owns what a
 * stage DOES (its run-stage dispatch table, e.g. RUN_STAGE_FNS).
 *
 * Semantics (see suite.ts StageNode for the manifest contract):
 *
 *   - `needs` absent  → depends on EVERY earlier `stages` entry
 *     (linear-chain default — string entries and pre-DAG manifests
 *     stay sequential).
 *   - `needs` present → exactly those stage ids; forward references
 *     are allowed, the topo sort resolves them. `needs: []` is a
 *     parallel branch root.
 *   - Levels: nodes whose needs all completed in earlier levels form
 *     a level; levels run in order, nodes within a level run with
 *     bounded concurrency (declared order preserved).
 *   - A node runs only when every REQUIRED need finished `ok` and
 *     every `optional` need finished `ok`-or-`failed`. A need that
 *     was `skipped` (condition false, or itself blocked) always
 *     blocks — a skipped stage produced no output to consume.
 *   - `when` is evaluated once the node's needs have completed, with
 *     `outputs` = every ok node's value so far. False → `skipped`.
 *   - `optional: true` tolerates the node's OWN failure: dependents
 *     still run. A failed required node skips its dependents.
 *   - Outcomes are COLLECTED per node (never thrown mid-graph): the
 *     caller decides whether any failure fails the run. Step defects
 *     surface as `BatchDefect` outcomes, same isolation rule as
 *     runBatch.
 *
 * Provenance: each plan node carries `needs` (→ RunRecord.parents)
 * and `branch` — the id of the single root ancestor (a needs-less
 * node) the node descends from, absent when the ancestry fans in
 * from multiple roots (a merge). Domains stamp these onto their
 * RunRecords; eval-core stays storage-agnostic.
 */

/** Graph validation failure — duplicate ids, unknown/self
 * dependencies, or a dependency cycle. */
export class StageGraphError extends Data.TaggedError("StageGraphError")<{
	readonly message: string;
	readonly detail?: string;
}> {}

/** A `when.condition` id with no registered evaluator. */
export class UnknownConditionError extends Data.TaggedError("UnknownConditionError")<{
	readonly condition: string;
	readonly stage: string;
}> {}

/** A plan node — StageNode with `needs` resolved to a concrete list
 * (the "all preceding entries" default already applied). */
export interface StagePlanNode extends StageNode {
	readonly needs: readonly string[];
	/** Single root ancestor id, or undefined on a multi-root merge. */
	readonly branch?: string;
}

/** Validated graph: nodes in declared order, execution levels, and
 * id → node lookup. */
export interface StagePlan {
	readonly nodes: readonly StagePlanNode[];
	readonly levels: readonly (readonly StagePlanNode[])[];
	readonly byId: ReadonlyMap<string, StagePlanNode>;
}

const fail = (message: string, detail?: string): never => {
	throw new StageGraphError(detail === undefined ? { message } : { message, detail });
};

/**
 * Validate + level a stage graph. Pure and total: returns the plan or
 * throws `StageGraphError`. `entries` are manifest `stages` entries —
 * strings normalize to `{id}` nodes.
 */
export const buildStagePlan = (entries: readonly StageEntry[]): StagePlan => {
	const raw = stageNodesOf(entries);
	const ids = raw.map((n) => n.id);
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) fail(`duplicate stage id "${id}"`);
		seen.add(id);
	}
	const idSet = new Set(ids);

	// Resolve needs: absent → every earlier entry (linear default);
	// present → exactly the declared ids (deduped, order kept).
	const nodes: StagePlanNode[] = raw.map((n, i) => {
		const needs = n.needs === undefined ? ids.slice(0, i) : [...new Set(n.needs)];
		for (const dep of needs) {
			if (dep === n.id) fail(`stage "${n.id}" cannot need itself`);
			if (!idSet.has(dep)) fail(`stage "${n.id}" needs unknown stage "${dep}"`);
		}
		return { ...n, needs };
	});
	// Kahn leveling FIRST — a node is ready once every need sits in
	// an earlier level. This is also the cycle check: it must precede
	// the branch-ancestor walk, which recurses over `needs` and would
	// not terminate on a cyclic graph. Within a level, declared order
	// is preserved.
	const done = new Set<string>();
	const levelIds: string[][] = [];
	const remaining = [...nodes];
	while (remaining.length > 0) {
		const ready = remaining.filter((n) => n.needs.every((d) => done.has(d)));
		if (ready.length === 0) {
			const stuck = remaining.map((n) => n.id).join(", ");
			fail(`stage graph has a dependency cycle`, `stuck: ${stuck}`);
		}
		levelIds.push(ready.map((n) => n.id));
		for (const n of ready) {
			done.add(n.id);
			remaining.splice(remaining.indexOf(n), 1);
		}
	}

	// Branch provenance: the single needs-less ancestor a node
	// descends from (safe now — the graph is acyclic). Fan-in merges
	// (multiple roots) get no branch.
	const rootsCache = new Map<string, readonly string[]>();
	const rootsOf = (id: string): readonly string[] => {
		const cached = rootsCache.get(id);
		if (cached !== undefined) return cached;
		const node = nodes.find((n) => n.id === id)!;
		const roots =
			node.needs.length === 0 ? [id] : [...new Set(node.needs.flatMap((d) => [...rootsOf(d)]))];
		rootsCache.set(id, roots);
		return roots;
	};
	const branched = nodes.map((n): StagePlanNode => {
		const roots = rootsOf(n.id);
		return roots.length === 1 ? { ...n, branch: roots[0] } : n;
	});
	const byId = new Map(branched.map((n) => [n.id, n]));
	const levels = levelIds.map((level) => level.map((id) => byId.get(id)!));

	return { nodes: branched, levels, byId };
};

/** What a condition evaluator sees: the declared params (JSON) and
 * every completed node's output so far, keyed by stage id. */
export interface ConditionContext<A> {
	readonly params: Readonly<Record<string, unknown>> | undefined;
	readonly outputs: ReadonlyMap<string, A>;
}

/** Condition evaluator — sync or Effect. Registered by id through
 * the `conditions` map (composition root merges builtinConditions
 * with domain evaluators); the id itself is a registered
 * `eval.condition` contribution validated by `eval list`. */
export type ConditionEvaluator<A, E = unknown, R = never> = (
	ctx: ConditionContext<A>,
) => boolean | Effect.Effect<boolean, E, R>;

/** Per-node scheduler outcome — the audit unit a DAG run emits. */
export interface StageNodeOutcome<A, E> {
	readonly node: StagePlanNode;
	readonly status: "ok" | "failed" | "skipped";
	readonly value?: A;
	/** Typed `E` failure, `StageGraphError`/`UnknownConditionError`,
	 * or `BatchDefect` when the step died. */
	readonly error?: E | StageGraphError | UnknownConditionError | BatchDefect;
	/** Why a node was skipped ("condition … false", "dependency …
	 * failed/skipped") — absent on ok/failed. */
	readonly reason?: string;
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Framework-generic condition evaluators — the seam every domain
 * shares. Domain packs register their own ids alongside these (the
 * composition root merges maps); `eval.condition` contributions make
 * the ids resolvable in manifests.
 */
export const builtinConditions: Readonly<Record<string, ConditionEvaluator<unknown>>> = {
	/** params.key names an output that exists and is non-empty
	 * (non-blank string, non-empty array, non-nullish otherwise). */
	nonempty: ({ params, outputs }) => {
		const key = params?.key;
		if (typeof key !== "string") return false;
		const v = outputs.get(key);
		if (v === undefined || v === null) return false;
		if (typeof v === "string") return v.trim() !== "";
		if (Array.isArray(v)) return v.length > 0;
		return true;
	},
	/** Unconditional — useful for tests and as a template. */
	always: () => true,
	/** Unconditional skip — template for domain conditions. */
	never: () => false,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Shared shape check for builtin-condition params: `config` must be
 * absent or a JSON object whose keys are all in `allowed`. */
const paramsValidator =
	(allowed: readonly string[], requireKey?: string) =>
	(config: unknown): ConfigValidation => {
		if (config !== undefined && !isRecord(config)) {
			return { ok: false, error: "condition params must be a JSON object" };
		}
		const p = (config ?? {}) as Record<string, unknown>;
		for (const key of Object.keys(p)) {
			if (!allowed.includes(key)) {
				return {
					ok: false,
					error: `unknown condition param "${key}" (known: ${allowed.join(", ") || "none"})`,
				};
			}
		}
		if (requireKey !== undefined) {
			const v = p[requireKey];
			if (typeof v !== "string" || v === "") {
				return { ok: false, error: `condition param "${requireKey}" must be a non-empty string` };
			}
		}
		return { ok: true, config: p };
	};

/**
 * `eval.condition` contribution declarations for the builtin
 * evaluators above (P-078): registering them makes `when.condition`
 * ids resolvable through the contribution registry — `eval list`
 * validates the ref AND its params shape via `validateConfig`, and
 * domain packs contribute their own condition ids the same way.
 * `meta.builtin` marks framework-owned ids.
 */
export const builtinConditionContributions: readonly ContributionWithConfig[] = [
	{
		kind: "eval.condition",
		id: "nonempty",
		version: "1",
		meta: { builtin: true },
		validateConfig: paramsValidator(["key"], "key"),
	},
	{
		kind: "eval.condition",
		id: "always",
		version: "1",
		meta: { builtin: true },
		// always/never ignore params entirely — declaring any is a
		// manifest bug, not something to silently drop.
		validateConfig: paramsValidator([]),
	},
	{
		kind: "eval.condition",
		id: "never",
		version: "1",
		meta: { builtin: true },
		validateConfig: paramsValidator([]),
	},
];

/**
 * Schedule a stage graph. Builds the plan (StageGraphError on invalid
 * graphs — the ONLY error-channel failure), then executes level by
 * level: nodes within a level run with `options.concurrency`
 * (default 4, declared order preserved), each wrapped in Effect.exit
 * so one node's failure — typed, defect, or interruption — becomes
 * its outcome instead of aborting siblings (same isolation rule as
 * runBatch). Returns outcomes in DECLARED node order.
 */
export const runStageGraph = <A, E, R>(input: {
	readonly entries: readonly StageEntry[];
	readonly run: (node: StagePlanNode) => Effect.Effect<A, E, R>;
	/** condition id → evaluator. Absent id on a `when` node = that
	 * node fails with UnknownConditionError (never silently runs). */
	readonly conditions?: Readonly<Record<string, ConditionEvaluator<A, E, R>>>;
	readonly concurrency?: number;
}): Effect.Effect<readonly StageNodeOutcome<A, E>[], StageGraphError, R> =>
	Effect.gen(function* () {
		const plan = yield* Effect.try({
			try: () => buildStagePlan(input.entries),
			// buildStagePlan only throws StageGraphError by construction.
			catch: (e) => e as StageGraphError,
		});
		const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
		const outputs = new Map<string, A>();
		const outcomes = new Map<string, StageNodeOutcome<A, E>>();

		const evalCondition = (
			node: StagePlanNode,
		): Effect.Effect<boolean, E | UnknownConditionError, R> => {
			const when = node.when;
			if (when === undefined) return Effect.succeed(true);
			const evaluator = input.conditions?.[when.condition];
			if (evaluator === undefined) {
				return Effect.fail(
					new UnknownConditionError({ condition: when.condition, stage: node.id }),
				);
			}
			return Effect.suspend(() => {
				const r = evaluator({
					params: when.params as Readonly<Record<string, unknown>> | undefined,
					outputs,
				});
				return Effect.isEffect(r) ? r : Effect.succeed(r);
			});
		};

		for (const level of plan.levels) {
			// Readiness gate: a node runs only when every need produced
			// an ok output, or failed OPTIONALly. Skipped deps always
			// block — there is no output to consume.
			const runnable = level.filter((node) => {
				for (const dep of node.needs) {
					const o = outcomes.get(dep)!;
					if (o.status === "ok") continue;
					const depNode = plan.byId.get(dep)!;
					if (o.status === "failed" && depNode.optional === true) continue;
					outcomes.set(node.id, {
						node,
						status: "skipped",
						reason: `dependency "${dep}" ${o.status}`,
					});
					return false;
				}
				return true;
			});

			const levelOutcomes = yield* Effect.forEach(
				runnable,
				(node) =>
					Effect.gen(function* () {
						const base = { node } as const;
						// Condition gate — evaluated with all prior outputs.
						const condExit = yield* Effect.exit(evalCondition(node));
						if (Exit.isFailure(condExit)) {
							const typed = Cause.findErrorOption(condExit.cause);
							if (Option.isSome(typed)) {
								return {
									...base,
									status: "failed" as const,
									error: typed.value as E | UnknownConditionError,
								} satisfies StageNodeOutcome<A, E>;
							}
							const defect = Cause.squash(condExit.cause);
							return {
								...base,
								status: "failed" as const,
								error: new BatchDefect({ message: String(defect), defect }),
							} satisfies StageNodeOutcome<A, E>;
						}
						if (!condExit.value) {
							return {
								...base,
								status: "skipped" as const,
								reason: `condition "${node.when!.condition}" false`,
							} satisfies StageNodeOutcome<A, E>;
						}
						const runExit = yield* Effect.exit(input.run(node));
						if (Exit.isSuccess(runExit)) {
							outputs.set(node.id, runExit.value);
							return {
								...base,
								status: "ok" as const,
								value: runExit.value,
							} satisfies StageNodeOutcome<A, E>;
						}
						const typed = Cause.findErrorOption(runExit.cause);
						if (Option.isSome(typed)) {
							return {
								...base,
								status: "failed" as const,
								error: typed.value as E,
							} satisfies StageNodeOutcome<A, E>;
						}
						const defect = Cause.squash(runExit.cause);
						return {
							...base,
							status: "failed" as const,
							error: new BatchDefect({ message: String(defect), defect }),
						} satisfies StageNodeOutcome<A, E>;
					}),
				{ concurrency },
			);
			for (const o of levelOutcomes) outcomes.set(o.node.id, o);
		}

		return plan.nodes.map((n) => outcomes.get(n.id)!);
	});

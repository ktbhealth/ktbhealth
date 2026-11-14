import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { describe, expect, it } from "vitest";

import { BatchDefect } from "./batch.ts";
import {
	buildStagePlan,
	builtinConditions,
	runStageGraph,
	StageGraphError,
	UnknownConditionError,
	type StageNodeOutcome,
} from "./dag.ts";

const statuses = (outcomes: readonly StageNodeOutcome<unknown, unknown>[]) =>
	Object.fromEntries(outcomes.map((o) => [o.node.id, o.status]));

describe("buildStagePlan", () => {
	it("string entries form a linear chain (declared order = needs)", () => {
		const plan = buildStagePlan(["a", "b", "c"]);
		expect(plan.levels.map((l) => l.map((n) => n.id))).toEqual([["a"], ["b"], ["c"]]);
		expect(plan.nodes.map((n) => n.needs)).toEqual([[], ["a"], ["a", "b"]]);
		// Single root ancestor → every node branches from "a".
		expect(plan.nodes.map((n) => n.branch)).toEqual(["a", "a", "a"]);
	});

	it("explicit needs declare edges; needs: [] starts a parallel branch", () => {
		const plan = buildStagePlan([
			"root",
			{ id: "left", needs: ["root"] },
			{ id: "right", needs: [] },
			{ id: "merge", needs: ["left", "right"] },
		]);
		expect(plan.levels.map((l) => l.map((n) => n.id))).toEqual([
			["root", "right"],
			["left"],
			["merge"],
		]);
		// "right" is its own root; "merge" fans in from two roots → no branch.
		expect(plan.byId.get("right")!.branch).toBe("right");
		expect(plan.byId.get("merge")!.branch).toBeUndefined();
		expect(plan.byId.get("left")!.branch).toBe("root");
	});

	it("absent needs on a node depends on all earlier entries", () => {
		const plan = buildStagePlan(["a", { id: "b", needs: [] }, "c"]);
		// "c" has no needs key → depends on BOTH earlier entries.
		expect(plan.byId.get("c")!.needs).toEqual(["a", "b"]);
		expect(plan.levels.map((l) => l.map((n) => n.id))).toEqual([["a", "b"], ["c"]]);
	});

	it("dedupes repeated needs and allows forward references", () => {
		const plan = buildStagePlan([
			{ id: "a", needs: ["b", "b"] },
			{ id: "b", needs: [] },
		]);
		expect(plan.byId.get("a")!.needs).toEqual(["b"]);
		expect(plan.levels.map((l) => l.map((n) => n.id))).toEqual([["b"], ["a"]]);
	});

	it("rejects duplicate stage ids", () => {
		expect(() => buildStagePlan(["a", "a"])).toThrowError(StageGraphError);
		expect(() => buildStagePlan(["a", "a"])).toThrowError(/duplicate stage id "a"/);
	});

	it("rejects self-needs and unknown needs", () => {
		expect(() => buildStagePlan([{ id: "a", needs: ["a"] }])).toThrowError(/cannot need itself/);
		expect(() => buildStagePlan([{ id: "a", needs: ["ghost"] }])).toThrowError(
			/needs unknown stage "ghost"/,
		);
	});

	it("rejects dependency cycles", () => {
		expect(() =>
			buildStagePlan([
				{ id: "a", needs: ["c"] },
				{ id: "b", needs: ["a"] },
				{ id: "c", needs: ["b"] },
			]),
		).toThrowError(/dependency cycle/);
	});
});

describe("runStageGraph", () => {
	const runOf = (fn: (id: string) => Effect.Effect<string, Error>) => (node: { id: string }) =>
		fn(node.id);

	it("runs a linear graph in order and returns declared-order outcomes", async () => {
		const seen: string[] = [];
		const outcomes = await Effect.runPromise(
			runStageGraph({
				entries: ["a", "b", "c"],
				run: (n) =>
					Effect.sync(() => {
						seen.push(n.id);
						return n.id.toUpperCase();
					}),
			}),
		);
		expect(seen).toEqual(["a", "b", "c"]);
		expect(outcomes.map((o) => [o.node.id, o.status, o.value])).toEqual([
			["a", "ok", "A"],
			["b", "ok", "B"],
			["c", "ok", "C"],
		]);
		expect(outcomes[0]!.node.needs).toEqual([]);
		expect(outcomes[1]!.node.branch).toBe("a");
	});

	it("runs independent branches concurrently within a level", async () => {
		const started: string[] = [];
		let release!: () => void;
		const blocker = new Promise<void>((r) => {
			release = r;
		});
		const outcomes = await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(
					runStageGraph({
						entries: [
							{ id: "a", needs: [] },
							{ id: "b", needs: [] },
							{ id: "join", needs: ["a", "b"] },
						],
						concurrency: 2,
						run: (n) =>
							Effect.promise(async () => {
								started.push(n.id);
								if (n.id !== "join") await blocker;
								return n.id;
							}),
					}),
				);
				// Let both roots start, then release them.
				yield* Effect.promise(() => new Promise((r) => setTimeout(r, 10)));
				expect(started.sort()).toEqual(["a", "b"]);
				release();
				return yield* Fiber.join(fiber);
			}),
		);
		expect(statuses(outcomes)).toEqual({ a: "ok", b: "ok", join: "ok" });
	});

	it("fails the graph build on invalid entries", async () => {
		const err = await Effect.runPromise(
			runStageGraph({ entries: ["a", "a"], run: () => Effect.succeed("x") }).pipe(Effect.flip),
		);
		expect(err).toBeInstanceOf(StageGraphError);
	});

	it("collects typed failures per node and skips dependents", async () => {
		const outcomes = await Effect.runPromise(
			runStageGraph({
				entries: ["a", "b", "c"],
				run: runOf((id) => (id === "b" ? Effect.fail(new Error("boom")) : Effect.succeed(id))),
			}),
		);
		expect(outcomes.map((o) => o.status)).toEqual(["ok", "failed", "skipped"]);
		expect(outcomes[1]!.error).toBeInstanceOf(Error);
		expect(outcomes[2]!.reason).toBe('dependency "b" failed');
	});

	it("optional nodes tolerate their own failure — dependents still run", async () => {
		const outcomes = await Effect.runPromise(
			runStageGraph({
				entries: ["a", { id: "b", optional: true }, { id: "c", needs: ["a", "b"] }],
				run: runOf((id) => (id === "b" ? Effect.fail(new Error("soft")) : Effect.succeed(id))),
			}),
		);
		expect(statuses(outcomes)).toEqual({ a: "ok", b: "failed", c: "ok" });
	});

	it("a skipped dependency always blocks its dependents", async () => {
		const outcomes = await Effect.runPromise(
			runStageGraph({
				entries: [
					{ id: "a", when: { condition: "never" } },
					{ id: "b", needs: ["a"] },
				],
				run: () => Effect.succeed("x"),
				conditions: builtinConditions,
			}),
		);
		expect(outcomes[0]!.status).toBe("skipped");
		expect(outcomes[0]!.reason).toBe('condition "never" false');
		expect(outcomes[1]!.status).toBe("skipped");
		expect(outcomes[1]!.reason).toBe('dependency "a" skipped');
	});

	it("when conditions see prior outputs (builtin nonempty)", async () => {
		const outcomes = await Effect.runPromise(
			runStageGraph({
				entries: [
					"produce",
					{ id: "maybe", when: { condition: "nonempty", params: { key: "produce" } } },
				],
				run: () => Effect.succeed("payload"),
				conditions: builtinConditions,
			}),
		);
		expect(statuses(outcomes)).toEqual({ produce: "ok", maybe: "ok" });
	});

	it("an Effect-returning evaluator works and sees outputs", async () => {
		const outcomes = await Effect.runPromise(
			runStageGraph<string, Error, never>({
				entries: ["a", { id: "b", needs: [], when: { condition: "check" } }],
				run: () => Effect.succeed("v"),
				conditions: {
					check: ({ outputs }) => Effect.succeed(outputs.get("a") === "v"),
				},
			}),
		);
		expect(statuses(outcomes)).toEqual({ a: "ok", b: "ok" });
	});

	it("a missing condition evaluator fails the node (never silently runs)", async () => {
		const outcomes = await Effect.runPromise(
			runStageGraph({
				entries: [{ id: "a", when: { condition: "ghost" } }],
				run: () => Effect.succeed("x"),
			}),
		);
		expect(outcomes[0]!.status).toBe("failed");
		expect(outcomes[0]!.error).toBeInstanceOf(UnknownConditionError);
	});

	it("a throwing condition evaluator surfaces as a BatchDefect outcome", async () => {
		const outcomes = await Effect.runPromise(
			runStageGraph({
				entries: [{ id: "a", when: { condition: "explode" } }],
				run: () => Effect.succeed("x"),
				conditions: {
					explode: () => {
						throw new Error("eval boom");
					},
				},
			}),
		);
		expect(outcomes[0]!.status).toBe("failed");
		expect(outcomes[0]!.error).toBeInstanceOf(BatchDefect);
	});

	it("a step defect becomes a BatchDefect outcome, not a crash", async () => {
		const outcomes = await Effect.runPromise(
			runStageGraph({
				entries: ["a", "b"],
				run: (n) => (n.id === "a" ? Effect.die(new Error("defect")) : Effect.succeed("ok")),
			}),
		);
		expect(outcomes[0]!.status).toBe("failed");
		expect(outcomes[0]!.error).toBeInstanceOf(BatchDefect);
		// "b" depends on "a" (linear default) → skipped.
		expect(outcomes[1]!.status).toBe("skipped");
	});
});

describe("builtinConditions", () => {
	it("nonempty checks presence + emptiness across value shapes", () => {
		const outputs = new Map<string, unknown>([
			["s", "  "],
			["t", "x"],
			["e", ""],
			["arr", []],
			["arr2", [1]],
			["n", null],
			["num", 0],
		]);
		const ctx = { params: { key: "t" }, outputs };
		expect(builtinConditions.nonempty!(ctx)).toBe(true);
		expect(builtinConditions.nonempty!({ ...ctx, params: { key: "s" } })).toBe(false);
		expect(builtinConditions.nonempty!({ ...ctx, params: { key: "e" } })).toBe(false);
		expect(builtinConditions.nonempty!({ ...ctx, params: { key: "arr" } })).toBe(false);
		expect(builtinConditions.nonempty!({ ...ctx, params: { key: "arr2" } })).toBe(true);
		expect(builtinConditions.nonempty!({ ...ctx, params: { key: "n" } })).toBe(false);
		expect(builtinConditions.nonempty!({ ...ctx, params: { key: "num" } })).toBe(true);
		expect(builtinConditions.nonempty!({ ...ctx, params: { key: "missing" } })).toBe(false);
		expect(builtinConditions.nonempty!({ ...ctx, params: {} })).toBe(false);
		expect(builtinConditions.nonempty!({ ...ctx, params: { key: 42 } })).toBe(false);
		expect(builtinConditions.nonempty!({ ...ctx, params: undefined })).toBe(false);
	});

	it("always/never are constant", () => {
		const ctx = { params: undefined, outputs: new Map() };
		expect(builtinConditions.always!(ctx)).toBe(true);
		expect(builtinConditions.never!(ctx)).toBe(false);
	});
});

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { BatchDefect, runBatch } from "./batch.ts";
import { PortError } from "./ports.ts";

const boom = (message = "boom") => new PortError({ port: "test", message });

describe("runBatch — resilience", () => {
	it("all items succeed", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["a", "b", "c"],
				step: (x) => Effect.succeed(`v-${x}`),
			}),
		);
		expect(r.ok).toEqual(["v-a", "v-b", "v-c"]);
		expect(r.failed).toEqual([]);
		expect(r.outcomes.every((o) => o.status === "ok" && o.attempts === 1)).toBe(true);
	});

	it("isolates failures — one error never aborts siblings", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["a", "bad", "c"],
				step: (x) => (x === "bad" ? Effect.fail(boom(x)) : Effect.succeed(`v-${x}`)),
			}),
		);
		expect(r.ok).toEqual(["v-a", "v-c"]);
		expect(r.failed).toEqual(["bad"]);
		const bad = r.outcomes[1]!;
		expect(bad.status).toBe("failed");
		expect(bad.error).toBeInstanceOf(PortError);
	});

	it("isolates a defecting item — siblings still complete", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["a", "bad", "c"],
				step: (x): Effect.Effect<string, PortError> =>
					x === "bad" ? Effect.die("kaput") : Effect.succeed(`v-${x}`),
				options: { retry: Schedule.recurs(2) },
			}),
		);
		expect(r.ok).toEqual(["v-a", "v-c"]);
		expect(r.failed).toEqual(["bad"]);
		const bad = r.outcomes[1]!;
		expect(bad.status).toBe("failed");
		expect(bad.error).toBeInstanceOf(BatchDefect);
		expect(bad.error?.message).toBe("kaput");
		// Defects bypass the retry schedule — they are not typed errors.
		expect(bad.attempts).toBe(1);
	});

	it("retries a flaky item and counts attempts", async () => {
		let calls = 0;
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () =>
					Effect.suspend(() => (++calls < 3 ? Effect.fail(boom("flaky")) : Effect.succeed("v-x"))),
				options: { retry: Schedule.recurs(3) },
			}),
		);
		expect(r.ok).toEqual(["v-x"]);
		expect(r.outcomes[0]?.attempts).toBe(3);
	});

	it("surfaces failure after the schedule exhausts", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () => Effect.fail(boom("always")),
				options: { retry: Schedule.recurs(2) },
			}),
		);
		expect(r.outcomes[0]?.status).toBe("failed");
		expect(r.outcomes[0]?.attempts).toBe(3); // initial + 2 recurs
		expect(r.outcomes[0]?.error?.message).toBe("always");
	});

	it("times out a hanging attempt", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () => Effect.sleep("2 seconds").pipe(Effect.as("late")),
				options: { timeoutMs: 30 },
			}),
		);
		expect(r.outcomes[0]?.status).toBe("timeout");
		expect(r.failed).toEqual(["x"]);
	});

	it("retries a timed-out attempt and recovers", async () => {
		let calls = 0;
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () =>
					Effect.suspend(() =>
						++calls === 1
							? Effect.sleep("2 seconds").pipe(Effect.as("late"))
							: Effect.succeed("v-x"),
					),
				options: { timeoutMs: 30, retry: Schedule.recurs(1) },
			}),
		);
		expect(r.outcomes[0]?.status).toBe("ok");
		expect(r.outcomes[0]?.attempts).toBe(2);
	});

	it("caps concurrency", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const r = await Effect.runPromise(
			runBatch({
				items: Array.from({ length: 10 }, (_, i) => i),
				step: () =>
					Effect.suspend(() => {
						inFlight++;
						maxInFlight = Math.max(maxInFlight, inFlight);
						return Effect.sleep("20 millis").pipe(
							Effect.tap(() => Effect.sync(() => void inFlight--)),
						);
					}),
				options: { concurrency: 3 },
			}),
		);
		expect(r.ok).toHaveLength(10);
		expect(maxInFlight).toBeLessThanOrEqual(3);
		expect(maxInFlight).toBeGreaterThan(1);
	});

	it("keeps outcomes aligned to input order even when steps resolve out of order", async () => {
		const r = await Effect.runPromise(
			runBatch({
				items: [0, 1, 2],
				step: (i) => Effect.sleep(`${(3 - i) * 10} millis`).pipe(Effect.as(i)),
			}),
		);
		expect(r.outcomes.map((o) => o.index)).toEqual([0, 1, 2]);
		expect(r.outcomes.map((o) => o.value)).toEqual([0, 1, 2]);
	});

	it("empty input returns an empty batch", async () => {
		const r = await Effect.runPromise(
			runBatch({ items: [] as string[], step: () => Effect.succeed(1) }),
		);
		expect(r.ok).toEqual([]);
		expect(r.outcomes).toEqual([]);
	});

	it("never fails the effect channel — outcomes carry the errors", async () => {
		const r = await Effect.runPromise(
			runBatch({ items: [1, 2, 3], step: () => Effect.fail(boom()) }),
		);
		expect(r.ok).toEqual([]);
		expect(r.failed).toHaveLength(3);
	});

	it("runs finalizers when an attempt is interrupted by timeout", async () => {
		const fin = await Effect.runPromise(Deferred.make<boolean, never>());
		const r = await Effect.runPromise(
			runBatch({
				items: ["x"],
				step: () => Effect.never.pipe(Effect.ensuring(Deferred.succeed(fin, true))),
				options: { timeoutMs: 30 },
			}),
		);
		expect(r.outcomes[0]?.status).toBe("timeout");
		await Effect.runPromise(Deferred.await(fin));
	});

	it("is deterministic — same inputs and steps give the same outcomes", async () => {
		const items = ["a", "b"];
		const batch = () => runBatch({ items, step: (x) => Effect.succeed(`v-${x}`) });
		const [a, b] = await Effect.runPromise(Effect.all([batch(), batch()]));
		expect(a.ok).toEqual(b.ok);
		expect(a.failed).toEqual(b.failed);
	});
});

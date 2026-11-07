import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import type { Anamnesis } from "./types.ts";
import { AnamnesisEngine, ReviewEngine } from "./services.ts";

describe("anamnesis service ports", () => {
	it("exposes stable service tag identifiers", () => {
		expect(AnamnesisEngine.key).toBe("@ktb/anamnesis/AnamnesisEngine");
		expect(ReviewEngine.key).toBe("@ktb/anamnesis/ReviewEngine");
	});

	it("tags are usable as Effect services", async () => {
		const engine = AnamnesisEngine.of({
			extract: () => Effect.succeed({ anamnesis: {} as Anamnesis, engine: "test" }),
		});
		const review = ReviewEngine.of({
			review: () => Effect.succeed({ review: null, reason: "n/a" }),
		});
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const a = yield* AnamnesisEngine;
				const r = yield* ReviewEngine;
				return { a, r };
			}).pipe(
				Effect.provideService(AnamnesisEngine, engine),
				Effect.provideService(ReviewEngine, review),
			),
		);
		expect(result.a).toBe(engine);
		expect(result.r).toBe(review);
	});
});

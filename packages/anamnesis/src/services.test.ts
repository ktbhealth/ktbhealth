import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import type { Anamnesis } from "./types.ts";
import { AnamnesisEngine } from "./services.ts";

describe("anamnesis service ports", () => {
	it("exposes a stable service tag identifier", () => {
		expect(AnamnesisEngine.key).toBe("@ktb/anamnesis/AnamnesisEngine");
	});

	it("tag is usable as an Effect service", async () => {
		const engine = AnamnesisEngine.of({
			extract: () => Effect.succeed({ anamnesis: {} as Anamnesis, engine: "test" }),
		});
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* AnamnesisEngine;
			}).pipe(Effect.provideService(AnamnesisEngine, engine)),
		);
		expect(result).toBe(engine);
	});
});

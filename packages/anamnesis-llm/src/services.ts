import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Anamnesis } from "@ktb/anamnesis";
import { extractAnamnesis } from "./index.ts";
import { makeReviewer, type ReviewResult } from "./review.ts";

/** Anamnesis extraction port — provider chosen inside the impl. */
export class AnamnesisEngine extends Context.Service<
	AnamnesisEngine,
	{
		readonly extract: (
			transcript: string,
		) => Effect.Effect<{ anamnesis: Anamnesis; engine: string }>;
	}
>()("@ktb/anamnesis-llm/AnamnesisEngine") {}

/** Second-opinion review port — each Live layer owns an isolated cache. */
export class ReviewEngine extends Context.Service<
	ReviewEngine,
	{
		readonly review: (transcript: string, anamnesis: Anamnesis) => Effect.Effect<ReviewResult>;
	}
>()("@ktb/anamnesis-llm/ReviewEngine") {}

export const AnamnesisEngineLive = Layer.succeed(
	AnamnesisEngine,
	AnamnesisEngine.of({
		extract: (transcript) => Effect.promise(() => extractAnamnesis(transcript)),
	}),
);

export const ReviewEngineLive = Layer.effect(
	ReviewEngine,
	Effect.sync(() => {
		const review = makeReviewer();
		return ReviewEngine.of({
			review: (transcript, anamnesis) => Effect.promise(() => review(transcript, anamnesis)),
		});
	}),
);

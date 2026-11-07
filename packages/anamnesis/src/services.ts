import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { Anamnesis, AnamnesisReview } from "./types.ts";

/**
 * Second-opinion review outcome. `review: null` carries a user-facing
 * `reason` — provider down, missing model, or bad output are recoverable.
 */
export type ReviewResult =
	| { review: AnamnesisReview; engine: string }
	| { review: null; reason: string };

/** Anamnesis extraction port — provider chosen inside the impl. */
export class AnamnesisEngine extends Context.Service<
	AnamnesisEngine,
	{
		readonly extract: (
			transcript: string,
		) => Effect.Effect<{ anamnesis: Anamnesis; engine: string }>;
	}
>()("@ktb/anamnesis/AnamnesisEngine") {}

/** Second-opinion review port — each Live layer owns an isolated cache. */
export class ReviewEngine extends Context.Service<
	ReviewEngine,
	{
		readonly review: (transcript: string, anamnesis: Anamnesis) => Effect.Effect<ReviewResult>;
	}
>()("@ktb/anamnesis/ReviewEngine") {}

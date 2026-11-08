import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { Anamnesis, ExtractInput } from "./types.ts";

/** Anamnesis extraction port — provider chosen inside the impl. */
export class AnamnesisEngine extends Context.Service<
	AnamnesisEngine,
	{
		readonly extract: (
			input: ExtractInput,
		) => Effect.Effect<{ anamnesis: Anamnesis; engine: string }>;
	}
>()("@ktb/anamnesis/AnamnesisEngine") {}

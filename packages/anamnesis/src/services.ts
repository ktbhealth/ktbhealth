import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { Anamnesis } from "./types.ts";

/** Anamnesis extraction port — provider chosen inside the impl. */
export class AnamnesisEngine extends Context.Service<
	AnamnesisEngine,
	{
		readonly extract: (
			transcript: string,
		) => Effect.Effect<{ anamnesis: Anamnesis; engine: string }>;
	}
>()("@ktb/anamnesis/AnamnesisEngine") {}

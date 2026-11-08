import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { LanguageModel, Prompt } from "effect/ai";

import type { Anamnesis } from "@ktb/anamnesis";
import { HeuristicExtractor } from "@ktb/anamnesis";
import { AnamnesisEngine } from "@ktb/anamnesis/services";
import { AnamnesisSchema } from "@ktb/anamnesis/schema";
import { PROMPT } from "./prompt.ts";
import { anthropicLanguageModelLive, openAiLanguageModelLive, type LlmConfig } from "./llm.ts";

export type { LlmConfig } from "./llm.ts";
import { DEFAULT_WORKERS_AI_MODEL, makeWorkersAiAnamnesisEngine } from "./workers-ai.ts";

// Port tags live in the domain package (@ktb/anamnesis/services); this
// module only provides the Live layers — impl → port direction.

const heuristicExtract = (transcript: string): Effect.Effect<Anamnesis> =>
	Effect.promise(() => new HeuristicExtractor().extract(transcript));

/**
 * Engine backed by a LanguageModel service. Requires `LanguageModel` —
 * tests provide a fake, the Live factories below provide a real provider.
 * LLM failure degrades to the deterministic heuristic extractor.
 */
export const makeAnamnesisEngine = (
	engineName: string,
): Layer.Layer<AnamnesisEngine, never, LanguageModel.LanguageModel> =>
	Layer.effect(
		AnamnesisEngine,
		Effect.gen(function* () {
			const model = yield* LanguageModel.LanguageModel;
			return AnamnesisEngine.of({
				extract: Effect.fn("AnamnesisEngine.extract")((transcript: string) =>
					model
						.generateObject({
							objectName: "anamnesis",
							schema: AnamnesisSchema,
							prompt: [
								Prompt.systemMessage({ content: PROMPT }),
								Prompt.userMessage({
									content: [Prompt.textPart({ text: transcript })],
								}),
							],
						})
						.pipe(
							Effect.map((r) => ({ anamnesis: r.value, engine: engineName })),
							Effect.catch((error) =>
								Effect.logWarning(`anamnesis extraction failed, using heuristic`, {
									engine: engineName,
									error: String(error),
								}).pipe(
									Effect.andThen(heuristicExtract(transcript)),
									Effect.map((anamnesis) => ({
										anamnesis,
										engine: `${engineName}!fallback`,
									})),
								),
							),
						),
				),
			});
		}),
	);

/** Deterministic-only engine — no credentials configured. */
export const heuristicAnamnesisEngineLive: Layer.Layer<AnamnesisEngine> = Layer.succeed(
	AnamnesisEngine,
	AnamnesisEngine.of({
		extract: Effect.fn("AnamnesisEngine.extract")((transcript: string) =>
			heuristicExtract(transcript).pipe(
				Effect.map((anamnesis) => ({ anamnesis, engine: "heuristic" })),
			),
		),
	}),
);

/**
 * Self-contained engine layer chosen from injected config — the
 * composition root supplies env-derived values; no process.env here.
 */
export const AnamnesisEngineLive = (cfg: LlmConfig): Layer.Layer<AnamnesisEngine> => {
	if (cfg.anthropicApiKey) {
		return makeAnamnesisEngine("anthropic").pipe(
			Layer.provide(
				anthropicLanguageModelLive({
					apiKey: cfg.anthropicApiKey,
					model: cfg.anthropicModel ?? "claude-haiku-4-5",
				}),
			),
		);
	}
	if (cfg.openAiApiKey) {
		return makeAnamnesisEngine("openai").pipe(
			Layer.provide(
				openAiLanguageModelLive({
					apiKey: cfg.openAiApiKey,
					baseUrl: cfg.openAiBaseUrl,
					model: cfg.openAiModel ?? "gpt-4o-mini",
				}),
			),
		);
	}
	if (cfg.workersAi) {
		return makeWorkersAiAnamnesisEngine(
			cfg.workersAi,
			cfg.workersAiModel ?? DEFAULT_WORKERS_AI_MODEL,
		);
	}
	return heuristicAnamnesisEngineLive;
};

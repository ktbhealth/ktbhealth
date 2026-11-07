import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { LanguageModel, Prompt } from "effect/ai";

import type { Anamnesis } from "@ktb/anamnesis";
import { HeuristicExtractor } from "@ktb/anamnesis";
import { AnamnesisSchema, AnamnesisReviewSchema } from "@ktb/anamnesis/schema";
import { PROMPT } from "./prompt.ts";
import { anthropicLanguageModelLive, openAiLanguageModelLive, type LlmConfig } from "./llm.ts";

export type { LlmConfig } from "./llm.ts";
import { REVIEW_PROMPT, reviewUserMessage, reviewViaOllama, type ReviewResult } from "./review.ts";
import { FetchHttpClient } from "effect/http";

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

export type ReviewProvider = "anthropic" | "openai" | "ollama";

/** REVIEW_PROVIDER forces one; otherwise cloud key if present, else local. */
export const selectReviewProvider = (cfg: LlmConfig): ReviewProvider => {
	if (
		cfg.reviewProvider === "anthropic" ||
		cfg.reviewProvider === "openai" ||
		cfg.reviewProvider === "ollama"
	)
		return cfg.reviewProvider;
	if (cfg.anthropicApiKey) return "anthropic";
	if (cfg.openAiApiKey) return "openai";
	return "ollama";
};

const REVIEW_TTL_MS = 5 * 60_000;

const degraded = (reason: string): ReviewResult => ({ review: null, reason });

/**
 * Cloud review engine backed by a LanguageModel. Requires `LanguageModel`;
 * failures degrade to `{ review: null, reason }` and are never cached.
 */
export const makeReviewEngine = (
	provider: "anthropic" | "openai",
	modelName: string,
): Layer.Layer<ReviewEngine, never, LanguageModel.LanguageModel> =>
	Layer.effect(
		ReviewEngine,
		Effect.gen(function* () {
			const model = yield* LanguageModel.LanguageModel;
			const cache = new Map<string, { expires: number; result: ReviewResult }>();
			const engine = `${provider}:${modelName}`;
			return ReviewEngine.of({
				review: Effect.fn("ReviewEngine.review")((transcript: string, anamnesis: Anamnesis) =>
					Effect.gen(function* () {
						const key = JSON.stringify([engine, transcript, anamnesis]);
						const hit = cache.get(key);
						if (hit && hit.expires > Date.now()) return hit.result;
						const result = yield* model
							.generateObject({
								objectName: "anamnesis_review",
								schema: AnamnesisReviewSchema,
								prompt: [
									Prompt.systemMessage({ content: REVIEW_PROMPT }),
									Prompt.userMessage({
										content: [Prompt.textPart({ text: reviewUserMessage(transcript, anamnesis) })],
									}),
								],
							})
							.pipe(
								Effect.map((r) => ({ review: r.value, engine }) satisfies ReviewResult),
								Effect.catch((error) =>
									Effect.logWarning(`review failed`, {
										engine,
										error: String(error),
									}).pipe(
										Effect.as(
											degraded(
												`Segunda opinião falhou: ${error instanceof Error ? error.message : String(error)}`,
											),
										),
									),
								),
							);
						if (result.review !== null) {
							cache.set(key, { expires: Date.now() + REVIEW_TTL_MS, result });
						}
						return result;
					}),
				),
			});
		}),
	);

/** Ollama review engine — plain HTTP, own TTL cache, never throws. */
export const makeOllamaReviewEngine = (
	baseUrl: string,
	modelName: string,
): Layer.Layer<ReviewEngine> =>
	Layer.effect(
		ReviewEngine,
		Effect.sync(() => {
			const cache = new Map<string, { expires: number; result: ReviewResult }>();
			const engine = `ollama:${modelName}`;
			return ReviewEngine.of({
				review: Effect.fn("ReviewEngine.review")((transcript: string, anamnesis: Anamnesis) =>
					Effect.gen(function* () {
						const key = JSON.stringify([engine, transcript, anamnesis]);
						const hit = cache.get(key);
						if (hit && hit.expires > Date.now()) return hit.result;
						const result = yield* reviewViaOllama({
							baseUrl,
							model: modelName,
							transcript,
							anamnesis,
						}).pipe(Effect.provide(FetchHttpClient.layer));
						if (result.review !== null) {
							cache.set(key, { expires: Date.now() + REVIEW_TTL_MS, result });
						}
						return result;
					}),
				),
			});
		}),
	);

/**
 * Self-contained engine layers chosen from injected config — the
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
	return heuristicAnamnesisEngineLive;
};

export const ReviewEngineLive = (cfg: LlmConfig): Layer.Layer<ReviewEngine> => {
	const provider = selectReviewProvider(cfg);
	if (provider === "anthropic" && cfg.anthropicApiKey) {
		return makeReviewEngine("anthropic", cfg.reviewModel ?? "claude-sonnet-5-5").pipe(
			Layer.provide(
				anthropicLanguageModelLive({
					apiKey: cfg.anthropicApiKey,
					model: cfg.reviewModel ?? "claude-sonnet-5-5",
				}),
			),
		);
	}
	if (provider === "openai" && cfg.openAiApiKey) {
		const model = cfg.reviewModel ?? cfg.openAiModel ?? "gpt-4o";
		return makeReviewEngine("openai", model).pipe(
			Layer.provide(
				openAiLanguageModelLive({
					apiKey: cfg.openAiApiKey,
					baseUrl: cfg.openAiBaseUrl,
					model,
				}),
			),
		);
	}
	return makeOllamaReviewEngine(
		cfg.ollamaUrl ?? "http://localhost:11434",
		cfg.ollamaModel ?? "qwen3:8b",
	);
};

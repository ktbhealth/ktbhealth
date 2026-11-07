import * as Layer from "effect/Layer";
import type { Driver } from "@ktb/driver-framework";

import { anthropicLanguageModelLive, openAiLanguageModelLive, type LlmConfig } from "./llm.ts";
import {
	AnamnesisEngine,
	ReviewEngine,
	heuristicAnamnesisEngineLive,
	makeAnamnesisEngine,
	makeOllamaReviewEngine,
	makeReviewEngine,
	selectReviewProvider,
} from "./services.ts";

/**
 * Driver descriptors for the AnamnesisEngine and ReviewEngine ports.
 * `when` predicates mirror the branch conditions of AnamnesisEngineLive /
 * ReviewEngineLive exactly — provider precedence (anthropic > openai for
 * extraction, REVIEW_PROVIDER forcing for review, ollama fallback) is
 * preserved, and each predicate is order-independent.
 */

// --- AnamnesisEngine: anthropic > openai > heuristic ---

export const anthropicAnamnesisDriver: Driver<LlmConfig> = {
	id: "anamnesis-anthropic",
	port: AnamnesisEngine.key,
	when: (cfg) => Boolean(cfg.anthropicApiKey),
	provides: (cfg) =>
		makeAnamnesisEngine("anthropic").pipe(
			Layer.provide(
				anthropicLanguageModelLive({
					apiKey: cfg.anthropicApiKey ?? "",
					model: cfg.anthropicModel ?? "claude-haiku-4-5",
				}),
			),
		),
};

export const openAiAnamnesisDriver: Driver<LlmConfig> = {
	id: "anamnesis-openai",
	port: AnamnesisEngine.key,
	when: (cfg) => !cfg.anthropicApiKey && Boolean(cfg.openAiApiKey),
	provides: (cfg) =>
		makeAnamnesisEngine("openai").pipe(
			Layer.provide(
				openAiLanguageModelLive({
					apiKey: cfg.openAiApiKey ?? "",
					baseUrl: cfg.openAiBaseUrl,
					model: cfg.openAiModel ?? "gpt-4o-mini",
				}),
			),
		),
};

export const heuristicAnamnesisDriver: Driver<LlmConfig> = {
	id: "anamnesis-heuristic",
	port: AnamnesisEngine.key,
	when: (cfg) => !cfg.anthropicApiKey && !cfg.openAiApiKey,
	provides: () => heuristicAnamnesisEngineLive,
};

// --- ReviewEngine: selectReviewProvider decides; ollama is the fallback ---

const isAnthropicReview = (cfg: LlmConfig): boolean =>
	selectReviewProvider(cfg) === "anthropic" && Boolean(cfg.anthropicApiKey);

const isOpenAiReview = (cfg: LlmConfig): boolean =>
	selectReviewProvider(cfg) === "openai" && Boolean(cfg.openAiApiKey);

export const anthropicReviewDriver: Driver<LlmConfig> = {
	id: "review-anthropic",
	port: ReviewEngine.key,
	when: isAnthropicReview,
	provides: (cfg) =>
		makeReviewEngine("anthropic", cfg.reviewModel ?? "claude-sonnet-5-5").pipe(
			Layer.provide(
				anthropicLanguageModelLive({
					apiKey: cfg.anthropicApiKey ?? "",
					model: cfg.reviewModel ?? "claude-sonnet-5-5",
				}),
			),
		),
};

export const openAiReviewDriver: Driver<LlmConfig> = {
	id: "review-openai",
	port: ReviewEngine.key,
	when: isOpenAiReview,
	provides: (cfg) => {
		const model = cfg.reviewModel ?? cfg.openAiModel ?? "gpt-4o";
		return makeReviewEngine("openai", model).pipe(
			Layer.provide(
				openAiLanguageModelLive({
					apiKey: cfg.openAiApiKey ?? "",
					baseUrl: cfg.openAiBaseUrl,
					model,
				}),
			),
		);
	},
};

export const ollamaReviewDriver: Driver<LlmConfig> = {
	id: "review-ollama",
	port: ReviewEngine.key,
	when: (cfg) => !isAnthropicReview(cfg) && !isOpenAiReview(cfg),
	provides: (cfg) =>
		makeOllamaReviewEngine(
			cfg.ollamaUrl ?? "http://localhost:11434",
			cfg.ollamaModel ?? "qwen3:8b",
		),
};

/** All LLM engine drivers, grouped by port in precedence order. */
export const llmDrivers: Driver<LlmConfig>[] = [
	anthropicAnamnesisDriver,
	openAiAnamnesisDriver,
	heuristicAnamnesisDriver,
	anthropicReviewDriver,
	openAiReviewDriver,
	ollamaReviewDriver,
];

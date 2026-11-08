import * as Layer from "effect/Layer";
import type { Driver } from "@ktb/driver-framework";

import { AnamnesisEngine } from "@ktb/anamnesis/services";
import { anthropicLanguageModelLive, openAiLanguageModelLive, type LlmConfig } from "./llm.ts";
import { heuristicAnamnesisEngineLive, makeAnamnesisEngine } from "./services.ts";
import { DEFAULT_WORKERS_AI_MODEL, makeWorkersAiAnamnesisEngine } from "./workers-ai.ts";

/**
 * Driver descriptors for the AnamnesisEngine port.
 * `when` predicates mirror the branch conditions of AnamnesisEngineLive
 * exactly — provider precedence (anthropic > openai > workers-ai >
 * heuristic) is preserved, and each predicate is order-independent.
 */

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

export const workersAiAnamnesisDriver: Driver<LlmConfig> = {
	id: "anamnesis-workers-ai",
	port: AnamnesisEngine.key,
	when: (cfg) => !cfg.anthropicApiKey && !cfg.openAiApiKey && Boolean(cfg.workersAi),
	provides: (cfg) =>
		makeWorkersAiAnamnesisEngine(
			cfg.workersAi as NonNullable<LlmConfig["workersAi"]>,
			cfg.workersAiModel ?? DEFAULT_WORKERS_AI_MODEL,
		),
};

export const heuristicAnamnesisDriver: Driver<LlmConfig> = {
	id: "anamnesis-heuristic",
	port: AnamnesisEngine.key,
	when: (cfg) => !cfg.anthropicApiKey && !cfg.openAiApiKey && !cfg.workersAi,
	provides: () => heuristicAnamnesisEngineLive,
};

/** All LLM engine drivers, grouped by port in precedence order. */
export const llmDrivers: Driver<LlmConfig>[] = [
	anthropicAnamnesisDriver,
	openAiAnamnesisDriver,
	workersAiAnamnesisDriver,
	heuristicAnamnesisDriver,
];

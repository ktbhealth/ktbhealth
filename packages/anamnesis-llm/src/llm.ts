import * as AnthropicClient from "@effect/ai-anthropic/AnthropicClient";
import * as AnthropicLanguageModel from "@effect/ai-anthropic/AnthropicLanguageModel";
import * as OpenAiClient from "@effect/ai-openai/OpenAiClient";
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel";
import { LanguageModel } from "effect/ai";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { FetchHttpClient } from "effect/http";

/**
 * Injected LLM configuration — resolved once by the composition root from
 * platform env/secrets. Provider packages never read process.env.
 */
export interface LlmConfig {
	readonly anthropicApiKey?: string;
	readonly anthropicModel?: string;
	readonly openAiApiKey?: string;
	readonly openAiBaseUrl?: string;
	readonly openAiModel?: string;
	readonly reviewModel?: string;
	readonly reviewProvider?: string;
	readonly ollamaUrl?: string;
	readonly ollamaModel?: string;
}

const http = FetchHttpClient.layer;

/** Self-contained OpenAI LanguageModel layer (client + fetch transport). */
export const openAiLanguageModelLive = (options: {
	readonly apiKey: string;
	readonly baseUrl?: string;
	readonly model: string;
}): Layer.Layer<LanguageModel.LanguageModel> =>
	OpenAiLanguageModel.layer({ model: options.model }).pipe(
		Layer.provide(
			OpenAiClient.layer({
				apiKey: Redacted.make(options.apiKey),
				...(options.baseUrl ? { apiUrl: options.baseUrl } : {}),
			}).pipe(Layer.provide(http)),
		),
	);

/** Self-contained Anthropic LanguageModel layer (client + fetch transport). */
export const anthropicLanguageModelLive = (options: {
	readonly apiKey: string;
	readonly model: string;
}): Layer.Layer<LanguageModel.LanguageModel> =>
	AnthropicLanguageModel.layer({ model: options.model }).pipe(
		Layer.provide(
			AnthropicClient.layer({
				apiKey: Redacted.make(options.apiKey),
			}).pipe(Layer.provide(http)),
		),
	);

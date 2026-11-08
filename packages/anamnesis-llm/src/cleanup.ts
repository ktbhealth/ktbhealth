import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import { LanguageModel, Prompt } from "effect/ai";

import { anthropicLanguageModelLive, openAiLanguageModelLive, type LlmConfig } from "./llm.ts";
import {
	DEFAULT_WORKERS_AI_MODEL,
	responseText,
	runChat,
	type WorkersAiBinding,
} from "./workers-ai.ts";

export interface CorrectedTranscript {
	readonly corrected: string;
	/** Provider tag, mirroring the anamnesis engine names. */
	readonly engine: string;
}

/**
 * Prompt contract (P-017): surface correction only — fix ASR errors,
 * punctuation and speaker-flow artifacts. Never summarize, reorder, or
 * invent clinical content; clinical terms stay verbatim; PT-BR output.
 */
export const CLEANUP_SYSTEM_PROMPT = `You are a transcription post-processor for Brazilian Portuguese (PT-BR) clinical consultations.

Fix only speech-recognition artifacts: punctuation, capitalization, obvious misrecognized words, and speaker-flow artifacts.

Rules:
- Output ONLY the corrected transcript text — no commentary, no labels, no JSON.
- Preserve clinical terms, drug names, dosages and proper nouns verbatim.
- Never summarize, reorder, add or remove clinical content.
- Keep the original language (PT-BR); do not translate.
- If the transcript is already clean, return it unchanged.`;

const userPrompt = (transcript: string) => [
	Prompt.systemMessage({ content: CLEANUP_SYSTEM_PROMPT }),
	Prompt.userMessage({ content: [Prompt.textPart({ text: transcript })] }),
];

const viaLanguageModel = (
	engine: string,
	layer: Layer.Layer<LanguageModel.LanguageModel>,
	transcript: string,
): Effect.Effect<CorrectedTranscript | null> =>
	Effect.gen(function* () {
		const model = yield* LanguageModel.LanguageModel;
		const response = yield* model.generateText({ prompt: userPrompt(transcript) });
		const corrected = response.text.trim();
		return corrected ? { corrected, engine } : null;
	}).pipe(
		Effect.provide(layer),
		Effect.catch((error) =>
			Effect.logWarning("transcript cleanup failed", { engine, error: String(error) }).pipe(
				Effect.as(null),
			),
		),
	);

const viaWorkersAi = (
	ai: WorkersAiBinding,
	model: string,
	transcript: string,
): Effect.Effect<CorrectedTranscript | null> => {
	const engine = `workers-ai:${model}`;
	return runChat(ai, model, CLEANUP_SYSTEM_PROMPT, transcript).pipe(
		Effect.map((raw) => {
			const corrected = responseText(raw).trim();
			return corrected ? { corrected, engine } : null;
		}),
		Effect.catch((error) =>
			Effect.logWarning("transcript cleanup failed", { engine, error: String(error) }).pipe(
				Effect.as(null),
			),
		),
	);
};

/**
 * LLM transcript cleanup (P-017): produces a corrected PT-BR transcript
 * alongside the raw server transcript. Provider precedence mirrors
 * AnamnesisEngineLive (anthropic > openai > workers-ai). Never fails —
 * returns null when unconfigured, empty input, or on any provider error,
 * so callers keep correctedTranscript null and the status stays "done".
 */
export const correctTranscript = (
	cfg: LlmConfig,
	transcript: string,
): Effect.Effect<CorrectedTranscript | null> => {
	const trimmed = transcript.trim();
	if (!trimmed) return Effect.succeed(null);
	if (cfg.anthropicApiKey) {
		return viaLanguageModel(
			"anthropic",
			anthropicLanguageModelLive({
				apiKey: cfg.anthropicApiKey,
				model: cfg.anthropicModel ?? "claude-haiku-4-5",
			}),
			trimmed,
		);
	}
	if (cfg.openAiApiKey) {
		return viaLanguageModel(
			"openai",
			openAiLanguageModelLive({
				apiKey: cfg.openAiApiKey,
				baseUrl: cfg.openAiBaseUrl,
				model: cfg.openAiModel ?? "gpt-4o-mini",
			}),
			trimmed,
		);
	}
	if (cfg.workersAi) {
		return viaWorkersAi(cfg.workersAi, cfg.workersAiModel ?? DEFAULT_WORKERS_AI_MODEL, trimmed);
	}
	return Effect.succeed(null);
};

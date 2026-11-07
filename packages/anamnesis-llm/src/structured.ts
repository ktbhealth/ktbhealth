import { AnthropicStructuredOutput, OpenAiStructuredOutput } from "effect/ai";
import { Schema } from "effect";

import { AnamnesisReviewSchema, AnamnesisSchema } from "@ktb/anamnesis/schema";

/**
 * Provider-compatible JSON schemas + authoritative decode codecs, via
 * effect/ai structured-output transformers. The codec is what validates
 * model output; the jsonSchema is the lossy provider-side hint.
 */
export const anthropicAnamnesis = AnthropicStructuredOutput.toCodecAnthropic(AnamnesisSchema);
export const openAiAnamnesis = OpenAiStructuredOutput.toCodecOpenAI(AnamnesisSchema);
export const anthropicReview = AnthropicStructuredOutput.toCodecAnthropic(AnamnesisReviewSchema);
export const openAiReview = OpenAiStructuredOutput.toCodecOpenAI(AnamnesisReviewSchema);

export const decodeAnthropicAnamnesis = Schema.decodeUnknownSync(anthropicAnamnesis.codec);
export const decodeOpenAiAnamnesis = Schema.decodeUnknownSync(openAiAnamnesis.codec);
export const decodeAnthropicReview = Schema.decodeUnknownSync(anthropicReview.codec);
export const decodeOpenAiReview = Schema.decodeUnknownSync(openAiReview.codec);

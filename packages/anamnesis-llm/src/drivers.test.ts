import { describe, expect, it } from "vitest";

import type { LlmConfig } from "./llm.ts";
import { AnamnesisEngine, heuristicAnamnesisEngineLive, ReviewEngine } from "./services.ts";
import {
	anthropicAnamnesisDriver,
	anthropicReviewDriver,
	heuristicAnamnesisDriver,
	llmDrivers,
	ollamaReviewDriver,
	openAiAnamnesisDriver,
	openAiReviewDriver,
} from "./drivers.ts";

describe("anamnesis engine drivers", () => {
	it("all provide the AnamnesisEngine port", () => {
		for (const d of [anthropicAnamnesisDriver, openAiAnamnesisDriver, heuristicAnamnesisDriver])
			expect(d.port).toBe(AnamnesisEngine.key);
	});

	it("anthropic is eligible iff its key is set", () => {
		expect(anthropicAnamnesisDriver.id).toBe("anamnesis-anthropic");
		expect(anthropicAnamnesisDriver.when?.({})).toBe(false);
		expect(anthropicAnamnesisDriver.when?.({ anthropicApiKey: "" })).toBe(false);
		expect(anthropicAnamnesisDriver.when?.({ anthropicApiKey: "k" })).toBe(true);
	});

	it("openai is eligible only when anthropic is absent and its key is set", () => {
		expect(openAiAnamnesisDriver.id).toBe("anamnesis-openai");
		expect(openAiAnamnesisDriver.when?.({})).toBe(false);
		expect(openAiAnamnesisDriver.when?.({ openAiApiKey: "k" })).toBe(true);
		expect(openAiAnamnesisDriver.when?.({ anthropicApiKey: "k", openAiApiKey: "k" })).toBe(false);
		expect(openAiAnamnesisDriver.when?.({ anthropicApiKey: "k" })).toBe(false);
	});

	it("heuristic is the fallback when no cloud key is set", () => {
		expect(heuristicAnamnesisDriver.id).toBe("anamnesis-heuristic");
		expect(heuristicAnamnesisDriver.when?.({})).toBe(true);
		expect(heuristicAnamnesisDriver.when?.({ openAiApiKey: "k" })).toBe(false);
		expect(heuristicAnamnesisDriver.when?.({ anthropicApiKey: "k" })).toBe(false);
		expect(heuristicAnamnesisDriver.when?.({ anthropicApiKey: "k", openAiApiKey: "k" })).toBe(
			false,
		);
	});

	it("provides build layers for every config shape", () => {
		expect(anthropicAnamnesisDriver.provides({})).toBeDefined();
		expect(
			anthropicAnamnesisDriver.provides({ anthropicApiKey: "k", anthropicModel: "m" }),
		).toBeDefined();
		expect(openAiAnamnesisDriver.provides({})).toBeDefined();
		expect(
			openAiAnamnesisDriver.provides({
				openAiApiKey: "k",
				openAiBaseUrl: "https://x",
				openAiModel: "m",
			}),
		).toBeDefined();
		expect(heuristicAnamnesisDriver.provides({})).toBe(heuristicAnamnesisEngineLive);
	});
});

describe("review engine drivers", () => {
	it("all provide the ReviewEngine port", () => {
		for (const d of [anthropicReviewDriver, openAiReviewDriver, ollamaReviewDriver])
			expect(d.port).toBe(ReviewEngine.key);
	});

	it("anthropic review follows selectReviewProvider and requires its key", () => {
		expect(anthropicReviewDriver.id).toBe("review-anthropic");
		expect(anthropicReviewDriver.when?.({})).toBe(false);
		expect(anthropicReviewDriver.when?.({ openAiApiKey: "k" })).toBe(false);
		expect(anthropicReviewDriver.when?.({ reviewProvider: "anthropic" })).toBe(false);
		expect(anthropicReviewDriver.when?.({ anthropicApiKey: "k" })).toBe(true);
	});

	it("openai review follows selectReviewProvider and requires its key", () => {
		expect(openAiReviewDriver.id).toBe("review-openai");
		expect(openAiReviewDriver.when?.({})).toBe(false);
		expect(openAiReviewDriver.when?.({ anthropicApiKey: "k" })).toBe(false);
		expect(openAiReviewDriver.when?.({ reviewProvider: "openai" })).toBe(false);
		expect(openAiReviewDriver.when?.({ openAiApiKey: "k" })).toBe(true);
		expect(openAiReviewDriver.when?.({ reviewProvider: "openai", openAiApiKey: "k" })).toBe(true);
	});

	it("ollama review is the fallback when no cloud review applies", () => {
		expect(ollamaReviewDriver.id).toBe("review-ollama");
		expect(ollamaReviewDriver.when?.({})).toBe(true);
		expect(ollamaReviewDriver.when?.({ anthropicApiKey: "k" })).toBe(false);
		expect(ollamaReviewDriver.when?.({ openAiApiKey: "k" })).toBe(false);
		// REVIEW_PROVIDER forces anthropic but the key is missing → ollama.
		expect(ollamaReviewDriver.when?.({ reviewProvider: "anthropic" })).toBe(true);
	});

	it("provides build layers for every config shape", () => {
		expect(anthropicReviewDriver.provides({})).toBeDefined();
		expect(
			anthropicReviewDriver.provides({
				anthropicApiKey: "k",
				reviewModel: "claude-x",
			}),
		).toBeDefined();
		expect(openAiReviewDriver.provides({})).toBeDefined();
		expect(openAiReviewDriver.provides({ openAiApiKey: "k", reviewModel: "r" })).toBeDefined();
		expect(openAiReviewDriver.provides({ openAiApiKey: "k", openAiModel: "o" })).toBeDefined();
		expect(openAiReviewDriver.provides({ openAiApiKey: "k" })).toBeDefined();
		expect(ollamaReviewDriver.provides({})).toBeDefined();
		expect(ollamaReviewDriver.provides({ ollamaUrl: "http://x", ollamaModel: "m" })).toBeDefined();
	});
});

describe("llmDrivers", () => {
	it("lists all six engine drivers", () => {
		expect(llmDrivers).toHaveLength(6);
		expect(llmDrivers.map((d) => d.id)).toEqual([
			"anamnesis-anthropic",
			"anamnesis-openai",
			"anamnesis-heuristic",
			"review-anthropic",
			"review-openai",
			"review-ollama",
		]);
	});
});

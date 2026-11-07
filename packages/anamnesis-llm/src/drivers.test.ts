import { describe, expect, it } from "vitest";

import type { LlmConfig } from "./llm.ts";
import { AnamnesisEngine, ReviewEngine } from "@ktb/anamnesis/services";
import { heuristicAnamnesisEngineLive } from "./services.ts";
import {
	anthropicAnamnesisDriver,
	anthropicReviewDriver,
	heuristicAnamnesisDriver,
	llmDrivers,
	ollamaReviewDriver,
	openAiAnamnesisDriver,
	openAiReviewDriver,
	workersAiAnamnesisDriver,
	workersAiReviewDriver,
} from "./drivers.ts";
import type { WorkersAiBinding } from "./workers-ai.ts";

const fakeWorkersAi: WorkersAiBinding = { run: async () => ({ response: "{}" }) };

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

	it("workers-ai is eligible only when cloud keys are absent and the binding exists", () => {
		expect(workersAiAnamnesisDriver.id).toBe("anamnesis-workers-ai");
		expect(workersAiAnamnesisDriver.when?.({})).toBe(false);
		expect(workersAiAnamnesisDriver.when?.({ workersAi: fakeWorkersAi })).toBe(true);
		expect(workersAiAnamnesisDriver.when?.({ openAiApiKey: "k", workersAi: fakeWorkersAi })).toBe(
			false,
		);
		expect(
			workersAiAnamnesisDriver.when?.({ anthropicApiKey: "k", workersAi: fakeWorkersAi }),
		).toBe(false);
	});

	it("heuristic is the fallback when no provider is configured", () => {
		expect(heuristicAnamnesisDriver.id).toBe("anamnesis-heuristic");
		expect(heuristicAnamnesisDriver.when?.({})).toBe(true);
		expect(heuristicAnamnesisDriver.when?.({ openAiApiKey: "k" })).toBe(false);
		expect(heuristicAnamnesisDriver.when?.({ anthropicApiKey: "k" })).toBe(false);
		expect(heuristicAnamnesisDriver.when?.({ anthropicApiKey: "k", openAiApiKey: "k" })).toBe(
			false,
		);
		expect(heuristicAnamnesisDriver.when?.({ workersAi: fakeWorkersAi })).toBe(false);
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
		expect(workersAiAnamnesisDriver.provides({ workersAi: fakeWorkersAi })).toBeDefined();
		expect(
			workersAiAnamnesisDriver.provides({
				workersAi: fakeWorkersAi,
				workersAiModel: "m",
			}),
		).toBeDefined();
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

	it("workers-ai review is selected by provider or by binding presence", () => {
		expect(workersAiReviewDriver.id).toBe("review-workers-ai");
		expect(workersAiReviewDriver.when?.({})).toBe(false);
		expect(workersAiReviewDriver.when?.({ workersAi: fakeWorkersAi })).toBe(true);
		expect(
			workersAiReviewDriver.when?.({
				reviewProvider: "workers-ai",
				workersAi: fakeWorkersAi,
			}),
		).toBe(true);
		expect(workersAiReviewDriver.when?.({ reviewProvider: "workers-ai" })).toBe(false);
		expect(workersAiReviewDriver.when?.({ openAiApiKey: "k", workersAi: fakeWorkersAi })).toBe(
			false,
		);
		expect(ollamaReviewDriver.when?.({ workersAi: fakeWorkersAi })).toBe(false);
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
		expect(workersAiReviewDriver.provides({ workersAi: fakeWorkersAi })).toBeDefined();
		expect(
			workersAiReviewDriver.provides({ workersAi: fakeWorkersAi, workersAiModel: "m" }),
		).toBeDefined();
	});
});

describe("llmDrivers", () => {
	it("lists all eight engine drivers", () => {
		expect(llmDrivers).toHaveLength(8);
		expect(llmDrivers.map((d) => d.id)).toEqual([
			"anamnesis-anthropic",
			"anamnesis-openai",
			"anamnesis-workers-ai",
			"anamnesis-heuristic",
			"review-anthropic",
			"review-openai",
			"review-workers-ai",
			"review-ollama",
		]);
	});
});

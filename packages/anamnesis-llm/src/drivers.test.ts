import { describe, expect, it } from "vitest";

import { AnamnesisEngine } from "@ktb/anamnesis/services";
import { heuristicAnamnesisEngineLive } from "./services.ts";
import {
	anthropicAnamnesisDriver,
	heuristicAnamnesisDriver,
	llmDrivers,
	openAiAnamnesisDriver,
	workersAiAnamnesisDriver,
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

describe("llmDrivers", () => {
	it("lists all four engine drivers", () => {
		expect(llmDrivers).toHaveLength(4);
		expect(llmDrivers.map((d) => d.id)).toEqual([
			"anamnesis-anthropic",
			"anamnesis-openai",
			"anamnesis-workers-ai",
			"anamnesis-heuristic",
		]);
	});
});

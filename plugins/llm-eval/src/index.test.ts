import { describe, expect, it } from "vitest";

import { ContributionRegistry, EvalPort } from "@ktb/eval-core";
import { LlmPort } from "@ktb/eval-consult/ports";

import { llmEvalContributions, plugins } from "./index.ts";

describe("llm.eval", () => {
	it("declares the llm/eval capabilities and model stages", () => {
		const registry = new ContributionRegistry();
		for (const c of llmEvalContributions) registry.register(c);

		expect(registry.get("capability", "llm").meta?.port).toBe(LlmPort.key);
		expect(registry.get("capability", "llm").meta?.adapters).toEqual({
			stub: "@ktb/eval-adapter-stub",
			acp: "@ktb/eval-adapter-local",
		});
		expect(registry.get("capability", "eval").meta?.port).toBe(EvalPort.key);
		expect(registry.get("capability", "eval").meta?.adapters).toEqual({
			stub: "@ktb/eval-adapter-stub",
			jev: "@ktb/eval-adapter-local",
			systemone: "@ktb/eval-adapter-local",
		});
		expect(registry.get("stage", "script_gen").meta?.port).toBe(LlmPort.key);
		expect(registry.get("stage", "cleanup").meta?.port).toBe(LlmPort.key);
		expect(registry.get("stage", "judge").meta?.port).toBe(EvalPort.key);
	});

	it("exposes a single plugin manifest", () => {
		expect(plugins.map((p) => p.id)).toEqual(["llm.eval"]);
	});
});
